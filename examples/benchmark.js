/**
 *  You need to install penthouse first to run this benchmark
 *  npm i penthouse criticalcss critical --no-save
 *
 *  node ./examples/benchmark.js
 */

"use strict";
const path         = require('path');
const Crittr       = require('../index');
const rootDir      = path.join(__dirname, "..");
const staticServer = require("../lib/helper/localFileServer")(rootDir);

staticServer.listen(8000, async () => {
    console.log("Server listening");

    const urls = [
        "http://localhost:8000/test/data/test.html?1",
        "http://localhost:8000/test/data/test.html?2",
        "http://localhost:8000/test/data/test.html?3",
        "http://localhost:8000/test/data/test.html?4",
        "http://localhost:8000/test/data/test.html?1",
        "http://localhost:8000/test/data/test.html?2",
        "http://localhost:8000/test/data/test.html?3",
        "http://localhost:8000/test/data/test.html?4",
        "http://localhost:8000/test/data/test.html?1",
        "http://localhost:8000/test/data/test.html?2",
        "http://localhost:8000/test/data/test.html?3",
        "http://localhost:8000/test/data/test.html?4",
        "http://localhost:8000/test/data/test.html?1",
        "http://localhost:8000/test/data/test.html?2",
        "http://localhost:8000/test/data/test.html?3",
        "http://localhost:8000/test/data/test.html?4",
        "http://localhost:8000/test/data/test.html?1",
        "http://localhost:8000/test/data/test.html?2",
        "http://localhost:8000/test/data/test.html?3",
        "http://localhost:8000/test/data/test.html?4"
    ];

    try {
        console.log("Start Critter Benchmark");
        console.time("Crittr");
        const {critical, rest} = await Crittr({
            urls:            urls,
            css:             rootDir + "/test/data/test.css",
            device:          {
                width:  1920,
                height: 1080
            },
            keepSelectors:   [
                ".forceInclude"
            ],
            removeSelectors: [
                ".forceExclude"
            ],
            browser:         {
                concurrentTabs: Infinity
            }

        });
        console.timeEnd("Crittr")
    } catch (err) {
        console.error(err);
    }

    /**
     *  PENTHOUSE
     */
    console.log("Start Penthouse Benchmark");
    const penthouse = require('penthouse');
    console.time("Penthouse");
    for (const url of urls) {
        try {

            const extracedCss = await penthouse({
                url:             url,
                css:             rootDir + "/test/data/test.css",
                width:           1920,
                height:          1080,
                forceInclude:    [
                    ".forceInclude"
                ],
                blockJsRequests: false

            });

        } catch (err) {
            console.error(err);
        }
    }
    console.timeEnd("Penthouse");

    /**
     * CRITICALCSS
     */
    console.log("Start CriticalCss Benchmark");
    const criticalcss = require("criticalcss");
    console.time("CriticalCss");
    const criticalCssWrapper = async () => {
        for (const url of urls) {
            await new Promise(resolve => {
                criticalcss.getRules(path.join(rootDir, "/test/data/test.css"), function (err, output) {
                    criticalcss.findCritical(url, {
                        rules:        JSON.parse(output),
                        width:        1920,
                        height:       1080,
                        forceInclude: [
                            ".forceInclude"
                        ]
                    }, function (err, output) {
                        if (err) {
                            throw new Error(err);
                        } else {
                            resolve(output);
                        }
                    });
                });
            })
        }
    };
    await criticalCssWrapper();
    console.timeEnd("CriticalCss");

    /**
     * CRITICALCSS
     */
    console.log("Start Critical Benchmark");
    const critical = require('critical');
    console.time("Critical");
    for (const url of urls) {
        critical.generate({
            base:    './',
            src:     './test/data/test.html',
            dest:    './test/data/test.css',
            width:   1920,
            height:  1080,
            include: [
                ".forceInclude"
            ]
        });

    }
    console.timeEnd("Critical");

    staticServer.close();
    process.exit(0);
}).on("error", (err) => {
    console.error(err)
});


