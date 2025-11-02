import { fromBase64 } from "@cosmjs/encoding";
import { assert, isNonNullObject } from "@cosmjs/utils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { type IArgon2Options, argon2id } from "hash-wasm";
import type { webcrypto } from "node:crypto";

export interface Argon2idOptions {
  /** Output length in bytes */
  readonly outputLength: number;
  /**
   * An integer between 1 and 4294967295 representing the computational difficulty.
   *
   * @see https://libsodium.gitbook.io/doc/password_hashing/default_phf#key-derivation
   */
  readonly opsLimit: number;
  /**
   * Memory limit measured in KiB (like argon2 command line tool)
   *
   * Note: only approximately 16 MiB of memory are available using the non-sumo version of libsodium.js
   *
   * @see https://libsodium.gitbook.io/doc/password_hashing/default_phf#key-derivation
   */
  readonly memLimitKib: number;
}

export function isArgon2idOptions(thing: unknown): thing is Argon2idOptions {
  if (!isNonNullObject(thing)) return false;
  if (typeof (thing as Argon2idOptions).outputLength !== "number") return false;
  if (typeof (thing as Argon2idOptions).opsLimit !== "number") return false;
  if (typeof (thing as Argon2idOptions).memLimitKib !== "number") return false;
  return true;
}

export class Argon2id {
  public static async execute(
    password: string,
    salt: Uint8Array,
    options: Argon2idOptions,
  ): Promise<Uint8Array> {
    const opts: IArgon2Options = {
      password,
      salt,
      outputType: "binary",
      iterations: options.opsLimit,
      memorySize: options.memLimitKib,
      parallelism: 1, // no parallelism allowed, just like libsodium
      hashLength: options.outputLength,
    };

    if (salt.length !== 16) {
      throw new Error(`Got invalid salt length ${salt.length}. Must be 16.`);
    }

    const hash = await argon2id(opts);
    // guaranteed by outputType: 'binary'
    assert(typeof hash !== "string");
    return hash;
  }
}

export class Ed25519Keypair {
  // a libsodium privkey has the format `<ed25519 privkey> + <ed25519 pubkey>`
  public static fromLibsodiumPrivkey(libsodiumPrivkey: Uint8Array): Ed25519Keypair {
    if (libsodiumPrivkey.length !== 64) {
      throw new Error(`Unexpected key length ${libsodiumPrivkey.length}. Must be 64.`);
    }
    return new Ed25519Keypair(libsodiumPrivkey.slice(0, 32), libsodiumPrivkey.slice(32, 64));
  }

  public readonly privkey: Uint8Array;
  public readonly pubkey: Uint8Array;

  public constructor(privkey: Uint8Array, pubkey: Uint8Array) {
    this.privkey = privkey;
    this.pubkey = pubkey;
  }

  public toLibsodiumPrivkey(): Uint8Array {
    return new Uint8Array([...this.privkey, ...this.pubkey]);
  }
}

export class Ed25519 {
  private static readonly pkcs8prefix = new Uint8Array([
    48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32,
  ]);
  private static readonly spkiPrefix = new Uint8Array([48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0]);

  private static async importPrivate(privKey: Uint8Array): Promise<webcrypto.CryptoKey> {
    assert(privKey.length === 32, `length=${privKey.length} but private key of length 32 expected`);
    const pkcs8 = new Uint8Array(48);
    pkcs8.set(Ed25519.pkcs8prefix, 0);
    pkcs8.set(privKey, 16);
    return await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  }

  private static async importPublic(pubKey: Uint8Array): Promise<webcrypto.CryptoKey> {
    assert(pubKey.length === 32, `length=${pubKey.length} but public key of length 32 expected`);
    const spki = new Uint8Array(44);
    spki.set(Ed25519.spkiPrefix, 0);
    spki.set(pubKey, 12);
    return await crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
  }

  /**
   * Generates a keypair deterministically from a given 32 bytes seed.
   *
   * This seed equals the Ed25519 private key.
   * For implementation details see crypto_sign_seed_keypair in
   * https://download.libsodium.org/doc/public-key_cryptography/public-key_signatures.html
   * and diagram on https://blog.mozilla.org/warner/2011/11/29/ed25519-keys/
   */
  public static async makeKeypair(privKey: Uint8Array): Promise<Ed25519Keypair> {
    const priv = await Ed25519.importPrivate(privKey);
    const jwk = await crypto.subtle.exportKey("jwk", priv);

    // Convert from base64url encoding used in JWK to standard base64 encoding.
    assert(jwk.x !== undefined && jwk.x.length === 43);
    const b64 = jwk.x.replace(/-/g, "+").replace(/_/g, "/") + "=";

    const pubKey = fromBase64(b64);
    return new Ed25519Keypair(privKey, pubKey);
  }

  public static async createSignature(message: Uint8Array, keyPair: Ed25519Keypair): Promise<Uint8Array> {
    const key = await Ed25519.importPrivate(keyPair.privkey);
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message));
  }

  public static async verifySignature(
    signature: Uint8Array,
    message: Uint8Array,
    pubkey: Uint8Array,
  ): Promise<boolean> {
    const key = await Ed25519.importPublic(pubkey);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
  }
}

/**
 * Nonce length in bytes for all flavours of XChaCha20.
 *
 * @see https://libsodium.gitbook.io/doc/advanced/stream_ciphers/xchacha20#notes
 */
export const xchacha20NonceLength = 24;

export class Xchacha20poly1305Ietf {
  public static async encrypt(message: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
    const additionalAuthenticatedData = undefined;

    const cipher = xchacha20poly1305(key, nonce, additionalAuthenticatedData);

    return cipher.encrypt(message);
  }

  public static async decrypt(
    ciphertext: Uint8Array,
    key: Uint8Array,
    nonce: Uint8Array,
  ): Promise<Uint8Array> {
    const additionalAuthenticatedData = undefined;

    const cipher = xchacha20poly1305(key, nonce, additionalAuthenticatedData);

    return cipher.decrypt(ciphertext);
  }
}
