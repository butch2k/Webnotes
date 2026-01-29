module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  maxWorkers: 1, // Run tests sequentially to avoid conflicts
  testTimeout: 10000,
  runInBand: true, // Force serial execution
};
