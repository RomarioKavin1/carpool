/** @type {import('next').NextConfig} */
// outputFileTracingRoot silences the multi-lockfile root-inference warning in the monorepo.
const path = require("path");
module.exports = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../../"),
};
