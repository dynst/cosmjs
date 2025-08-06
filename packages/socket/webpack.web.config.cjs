/* eslint-disable @typescript-eslint/naming-convention */
const { globSync } = require("glob");
const path = require("path");
const webpack = require("webpack");

const target = "web";
const distdir = path.join(__dirname, "dist", "web");

module.exports = [
  {
    // bundle used for Karma tests
    target: target,
    entry: globSync("./build/**/*.spec.js", { dotRelative: true }).sort(),
    output: {
      path: distdir,
      filename: "tests.js",
    },
    plugins: [new webpack.EnvironmentPlugin({ SOCKETSERVER_ENABLED: "" })],
    resolve: {
      alias: {
        child_process: "data:text/javascript,export {};",
      },
      fallback: {
        assert: false,
      },
    },
  },
];
