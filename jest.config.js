// jest.config.js
module.exports = {
    projects: [
        {
            displayName: "Basic",
            globalSetup: './test/setup.basic.js',
            globalTeardown: './test/teardown.js',
            roots: [
                "./test"
            ],
            testMatch: ["**/test/**/*.test.js?(x)"],
            testURL: 'http://localhost'
        },
        {
            displayName: "No CSS",
            globalSetup: './test/setup.nocss.js',
            globalTeardown: './test/teardown.js',
            roots: [
                "./test"
            ],
            testMatch: ["**/test/**/*.test.js?(x)"],
        }
    ]
};
