"use strict";

const fs = require("fs-extra");
const util = require("util");
const path = require("path");
const readFilePromise = util.promisify(fs.readFile);
const debug = require("debug")("Crittr Class");
const log = require("signale");
const chalk = require("chalk");
const merge = require("deepmerge");
const Queue = require("run-queue");
const puppeteer = require("puppeteer");
const devices = puppeteer.devices;
const CleanCSS = require("clean-css");
const postcss = require("postcss");
const sortMediaQueries = require("postcss-sort-media-queries");

const DEFAULTS = require("../Constants");
const Ast = require("./Ast.class");

const CssTransformator = require("./CssTransformator.class");
const extractCriticalCss_script = require("../evaluation/extract_critical_with_css");

/**
 * CRITTR Class
 */
class Crittr {
    /**
     * Crittr Class to extract critical css from an given url
     *
     * @param {Object}  [options]                               - The options object itself
     * @param {string}  options.css                             - Can be a file path or css string or null
     * @param {number}  [options.timeout=30000]                 - After this time the navigation to the page will be stopped. Prevents
     *                                                          execution time explosion
     * @param {number}  [options.pageLoadTimeout=2000]          - after load event of page this time is set to wait for x seconds
     *                                                          until the page load is manually stopped
     * @param {Object}  [options.browser]                       - Browser configuration object
     * @param {Object}  [options.device]                        - Device configuration object
     * @param {Object}  [options.puppeteer]                     - Puppeteer configuration object
     * @param {Boolean} [options.printBrowserConsole=false]     - Enables browser console output to stdout if set to true.
     * @param {Boolean} [options.dropKeyframes=true]            - Drops keyframe rules if set to true.
     * @param {Boolean} [options.dropKeyframes=true]            - Drops keyframe rules if set to true.
     * @param {Array}   [options.keepSelectors=[]]              - Array list of selectors which have to be kept in
     *                                                          critical css even if they are NOT part of it
     * @param {Array}   [options.removeSelectors=[]]            - Array list of selectors which have to be removed in
     *                                                          critical css even if they are part of it
     * @param {Array}   [options.blockRequests=[...]            - URLs of websites mostly used to be part of tracking or
     *                                                          analytics. Not needed for critical css so they are aborted
     *
     * @returns Promise<[<string>,<string>]>
     */
    constructor(options) {
        this.options = {
            css: null,
            urls: [],
            timeout: DEFAULTS.TIMEOUT,
            pageLoadTimeout: DEFAULTS.PAGE_LOAD_TIMEOUT,
            outputRemainingCss: DEFAULTS.OUTPUT_REMAINING_CSS,
            browser: {
                userAgent: DEFAULTS.BROWSER_USER_AGENT,
                isCacheEnabled: DEFAULTS.BROWSER_CACHE_ENABLED,
                isJsEnabled: DEFAULTS.BROWSER_JS_ENABLED,
                concurrentTabs: DEFAULTS.BROWSER_CONCURRENT_TABS,
            },
            device: {
                width: DEFAULTS.DEVICE_WIDTH,
                height: DEFAULTS.DEVICE_HEIGHT,
                scaleFactor: DEFAULTS.DEVICE_SCALE_FACTOR,
                isMobile: DEFAULTS.DEVICE_IS_MOBILE,
                hasTouch: DEFAULTS.DEVICE_HAS_TOUCH,
                isLandscape: DEFAULTS.DEVICE_IS_LANDSCAPE,
            },
            puppeteer: {
                browser: null,
                chromePath: null,
                headless: DEFAULTS.PUPPETEER_HEADLESS,
            },
            printBrowserConsole: DEFAULTS.PRINT_BROWSER_CONSOLE,
            dropKeyframes: DEFAULTS.DROP_KEYFRAMES,
            takeScreenshots: DEFAULTS.PAGE_SCREENSHOT,
            screenshotPath: path.join("."),
            keepSelectors: [],
            removeSelectors: [],
            blockRequests: [
                "maps.gstatic.com",
                "maps.googleapis.com",
                "googletagmanager.com",
                "google-analytics.com",
                "google.",
                "googleadservices.com",
                "generaltracking.de",
                "bing.com",
                "doubleclick.net",
            ],
        };
        this.options = merge(this.options, options);

        this._browser = null;
        this._cssTransformator = new CssTransformator();

        // Check device
        if (typeof this.options.device === "string") {
            if (devices[this.options.device]) {
                this.options.device = devices[this.options.device].viewport;
            } else {
                log.error(
                    "Option 'device' is set as string but has an unknown value. Use devices of puppeteer (https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js) or an object!"
                );
            }
        }

        // Validate some of the options like url and css
        const optionsErrors = this.validateOptions();

        if (optionsErrors.length > 0) {
            optionsErrors.forEach(({ message }) => {
                log.error(message);
            });
            // Exit process when options are invalid
            throw new Error("crittr stopped working. See errors above.");
        }
    }

    /**
     *  Validates parts of the class options to check if they fit the requirements
     *
     * @returns {Array} errors  Array containing errors for options not matching requirements
     */
    validateOptions() {
        const errors = [];
        // Check url
        if (!Array.isArray(this.options.urls)) {
            errors.push({
                message: "Urls not an Array",
            });
        }

        if (
            Array.isArray(this.options.urls) &&
            this.options.urls.length === 0
        ) {
            errors.push(
                new Error(
                    "NO URLs to check. Insert at least one url in the urls option!"
                )
            );
        }

        if (typeof this.options.css !== "string" && this.options.css !== null) {
            errors.push({
                message:
                    "css not valid. Expected string got " +
                    typeof this.options.css,
            });
        }

        if (typeof this.options.screenshotPath !== "string") {
            errors.push({
                message: "screenshotPath needs to be a string",
            });
        }
        return errors;
    }

    /**
     * This is our main execution point of the crittr class.
     *
     * @returns {Promise<[<string>, <string>]>}
     */
    run() {
        return new Promise(async (resolve, reject) => {
            debug("run - Starting run ...");

            let criticalCss = "";
            let restCss = "";
            let errors = [];

            try {
                debug("run - Starting browser ...");
                this._browser = await this.getBrowser();
                debug("run - Browser started!");
            } catch (err) {
                debug("run - ERROR: Browser could not be launched ... abort!");
                reject(err);
            }

            try {
                debug("run - Get css content ...");
                this._cssContent = await this.getCssContent();
                debug("run - Get css content done!");
            } catch (err) {
                debug("run - ERROR while extracting css content");
                reject(err);
            }

            try {
                debug("run - Starting critical css extraction ...");
                [criticalCss, restCss, errors] =
                    await this.getCriticalCssFromUrls();
                if (errors.length > 0) {
                    log.warn(
                        "Some of the urls had errors. Please review them below!"
                    );
                    this.printErrors(errors);
                }
                debug("run - Finished critical css extraction!");
            } catch (err) {
                debug("run - ERROR while critical css extraction");
                reject(err);
            }

            try {
                debug("run - Browser closing ...");
                await this._browser.close();
                debug("run - Browser closed!");
            } catch (err) {
                debug(
                    "run - ERROR: Browser could not be closed -> already closed?"
                );
            }

            debug("run - Extraction ended!");
            resolve({ critical: criticalCss, rest: restCss });
        });
    }

    /**
     * Returns the browser object of the underlying headless browser
     *
     * @returns {Promise<any>}
     */
    getBrowser() {
        return new Promise(async (resolve, reject) => {
            try {
                if (this.options.puppeteer.browser !== null) {
                    resolve(this.options.puppeteer.browser);
                }
                const browser = await puppeteer
                    .launch({
                        ignoreHTTPSErrors: true,
                        args: [
                            "--disable-setuid-sandbox",
                            "--no-sandbox",
                            "--ignore-certificate-errors",
                            "--disable-dev-shm-usage",
                            //                        '--no-gpu'
                        ],
                        dumpio: false,
                        headless: this.options.puppeteer.headless,
                        executablePath: this.options.puppeteer.chromePath,
                    })
                    .then((browser) => {
                        return browser;
                    });

                resolve(browser);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Tries to gracefully closes a page obj to ensure the uninterrupted progress of extraction
     *
     * @param page {!Promise<!Puppeteer.Page>}
     * @param errors {Array<Error>}
     * @returns {Promise<any>}
     */
    gracefulClosePage(page, errors) {
        return new Promise(async (resolve, reject) => {
            this.printErrors(errors);

            try {
                debug(
                    "gracefulClosePage - Closing page after error gracefully ..."
                );
                await page.close();
                debug("gracefulClosePage - Page closed gracefully!");
            } catch (err) {
                debug(
                    "gracefulClosePage - Error while closing page -> already closed?"
                );
            }
            resolve();
        });
    }

    /**
     * Outputs the errors in a readable way to the stdout/stderr
     *
     * @param errors
     */
    printErrors(errors) {
        if (errors) {
            log.warn(
                chalk.red(
                    "Errors occured during processing. Please have a look and report them if necessary"
                )
            );
            if (Array.isArray(errors)) {
                for (let error of errors) {
                    log.error(error);
                }
            } else {
                log.error(errors);
            }
        }
    }

    /**
     * Returns a page of the underlying browser engine
     *
     * @returns {!Promise<!Puppeteer.Page> | *}
     */
    getPage() {
        return this._browser.newPage();
    }

    /**
     * Tries to get the contents of the given css file or in case of css string returns the string
     *
     * @returns {Promise<any>}
     */
    getCssContent() {
        return new Promise(async (resolve, reject) => {
            if (typeof this.options.css === "string") {
                let cssString = "";
                if (this.options.css.endsWith(".css")) {
                    try {
                        cssString = await readFilePromise(
                            this.options.css,
                            "utf8"
                        );
                        if (cssString.length === 0) {
                            reject(
                                new Error(
                                    "No CSS content in file exists -> exit!"
                                )
                            );
                        }
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    cssString = this.options.css;
                }

                resolve(cssString);
            } else if (!this.options.css) {
                let cssString = await this.getCssFromUrl(this.options.urls[0]);

                resolve(cssString);
            }
        });
    }

    async getCssFromUrl(url) {
        let cssString = "";
        const page = await this.getPage();

        await page.coverage.startCSSCoverage();
        await page.goto(url, {waitUntil: 'load'})

        cssString = await page.evaluate(() => {
            return [...document.styleSheets]
                .map(styleSheet => {
                    try {
                        return [...styleSheet.cssRules]
                            .map(rule => rule.cssText)
                            .join('');
                    } catch (e) {
                        console.log('Access to stylesheet %s is denied. Ignoring...', styleSheet.href);
                    }
                })
                .filter(Boolean)
                .join('\n');
        });

        return cssString
    }

    /**
     *
     * Starts an url evaluation with all operations to extract the critical css
     *
     * @returns {Promise<[<Object>, <Object>, <Array>]>}
     */
    getCriticalCssFromUrls() {
        return new Promise(async (resolve, reject) => {
            let errors = [];
            const urls = this.options.urls;
            const criticalAstSets = new Set();
            const restAstSets = new Set();
            const sourceCssAst = this._cssTransformator.getAst(
                this._cssContent
            );

            const queue = new Queue({
                maxConcurrency: this.options.browser.concurrentTabs,
            });

            // Add to queue

            const queueEvaluateFn = async (
                url,
                sourceCssAst,
                criticalAstSets,
                restAstSets
            ) => {
                try {
                    debug(
                        "getCriticalCssFromUrls - Try to get critical ast from " +
                            url
                    );
                    const [criticalAst, restAst] = await this.evaluateUrl(
                        url,
                        sourceCssAst
                    );
                    criticalAstSets.add(criticalAst);
                    restAstSets.add(restAst);
                    debug(
                        "getCriticalCssFromUrls - Successfully extracted critical ast!"
                    );
                } catch (err) {
                    debug(
                        "getCriticalCssFromUrls - ERROR getting critical ast from promise"
                    );
                    log.error("Could not get critical ast for url " + url);
                    log.error(err);
                    errors.push(err);
                }
            };

            for (let url of urls) {
                queue.add(1, queueEvaluateFn, [
                    url,
                    sourceCssAst,
                    criticalAstSets,
                    restAstSets,
                ]);
            }

            queue
                .run()
                .then(async () => {
                    if (criticalAstSets.size === 0) {
                        reject(errors);
                    }

                    // remember to use wildcards. Greedy seems to be the perfect fit
                    // Just *selector* matches all selector that have at least selector in their string
                    // *sel* needs only sel and so on

                    // Create the Rule Maps for further iteration
                    debug(
                        "getCriticalCssFromUrls - Merging multiple atf ast objects. Size: " +
                            criticalAstSets.size
                    );
                    let atfRuleMap = new Map();
                    for (let astObj of criticalAstSets) {
                        try {
                            // Merge all extracted ASTs into a final one
                            atfRuleMap = Ast.generateRuleMap(
                                astObj,
                                atfRuleMap
                            );
                        } catch (err) {
                            debug(
                                "getCriticalCssFromUrls - ERROR merging multiple atf ast objects"
                            );
                            reject(err);
                        }
                    }
                    debug(
                        "getCriticalCssFromUrls - Merging multiple atf ast objects - finished"
                    );

                    // Only do the more time consuming steps if needed
                    let restRuleMap = new Map();
                    if (this.options.outputRemainingCss) {
                        debug(
                            "getCriticalCssFromUrls - Merging multiple rest ast objects. Size: " +
                                restAstSets.size
                        );
                        for (let astObj of restAstSets) {
                            try {
                                // Merge all extracted ASTs into a final one
                                restRuleMap = Ast.generateRuleMap(
                                    astObj,
                                    restRuleMap
                                );
                            } catch (err) {
                                debug(
                                    "getCriticalCssFromUrls - ERROR merging multiple rest ast objects"
                                );
                                reject(err);
                            }
                        }
                        debug(
                            "getCriticalCssFromUrls - Merging multiple rest ast objects - finished"
                        );

                        // Filter rules out of restRuleMap which already exists in atfRuleMap
                        debug(
                            "getCriticalCssFromUrls - Filter duplicates of restMap"
                        );
                        for (const [atfRuleKey, atfRuleObj] of atfRuleMap) {
                            // Check if ruleKey exists in restMap
                            // If not it is only in atfMap. This is the wanted behaviour
                            if (restRuleMap.has(atfRuleKey)) {
                                // Get the rules array for the rule key
                                let restRuleArr = restRuleMap.get(atfRuleKey);
                                // RestMap has the same ruleKey as atf. We need to check now if the rules in this key match
                                // But before we divide between media rules and rules
                                restRuleArr = restRuleArr.filter(
                                    (ruleObj) =>
                                        !atfRuleObj.some(
                                            (atfRule) =>
                                                ruleObj.hash === atfRule.hash
                                        )
                                );
                                if (restRuleArr.length > 0) {
                                    restRuleMap.set(atfRuleKey, restRuleArr);
                                } else {
                                    restRuleMap.delete(atfRuleKey);
                                }
                            }
                        }
                        debug(
                            "getCriticalCssFromUrls - Filter duplicates of restMap - finished"
                        );
                    }

                    // CleanCSS Config
                    const ccss = new CleanCSS({
                        compatibility: "*",
                        properties: {
                            backgroundClipMerging: false, // controls background-clip merging into shorthand
                            backgroundOriginMerging: false, // controls background-origin merging into shorthand
                            backgroundSizeMerging: false, // controls background-size merging into shorthand
                            colors: false, // controls color optimizations
                            ieBangHack: false, // controls keeping IE bang hack
                            ieFilters: false, // controls keeping IE `filter` / `-ms-filter`
                            iePrefixHack: false, // controls keeping IE prefix hack
                            ieSuffixHack: false, // controls keeping IE suffix hack
                            merging: true, // controls property merging based on understandability
                            shorterLengthUnits: false, // controls shortening pixel units into `pc`, `pt`, or `in` units
                            spaceAfterClosingBrace: true, // controls keeping space after closing brace - `url() no-repeat` into `url()no-repeat`
                            urlQuotes: true, // controls keeping quoting inside `url()`
                            zeroUnits: false, // controls removal of units `0` value
                        },
                        selectors: {
                            adjacentSpace: false, // controls extra space before `nav` element
                            ie7Hack: true, // controls removal of IE7 selector hacks, e.g. `*+html...`
                            mergeLimit: 1000, // controls maximum number of selectors in a single rule (since 4.1.0)
                            multiplePseudoMerging: false, // controls merging of rules with multiple pseudo classes / elements (since 4.1.0)
                        },
                        level: {
                            1: {
                                all: false,
                                cleanupCharsets: true, // controls `@charset` moving to the front of a stylesheet; defaults to `true`
                                removeWhitespace: false, // controls removing unused whitespace; defaults to `true`
                            },
                            2: {
                                mergeAdjacentRules: true, // controls adjacent rules merging; defaults to true
                                mergeIntoShorthands: false, // controls merging properties into shorthands; defaults to true
                                mergeMedia: true, // controls `@media` merging; defaults to true
                                mergeNonAdjacentRules: true, // controls non-adjacent rule merging; defaults to true
                                mergeSemantically: false, // controls semantic merging; defaults to false
                                overrideProperties: true, // controls property overriding based on understandability; defaults to true
                                removeEmpty: true, // controls removing empty rules and nested blocks; defaults to `true`
                                reduceNonAdjacentRules: true, // controls non-adjacent rule reducing; defaults to true
                                removeDuplicateFontRules: true, // controls duplicate `@font-face` removing; defaults to true
                                removeDuplicateMediaBlocks: true, // controls duplicate `@media` removing; defaults to true
                                removeDuplicateRules: true, // controls duplicate rules removing; defaults to true
                                removeUnusedAtRules: false, // controls unused at rule removing; defaults to false (available since 4.1.0)
                                restructureRules: false, // controls rule restructuring; defaults to false
                            },
                        },
                    });

                    // Create the AST Objects out of the RuleMaps to being able to convert them to CSS again
                    debug(
                        "getCriticalCssFromUrls - Creating AST Object of atf ruleMap"
                    );
                    let finalAtfAst = Ast.getAstOfRuleMap(atfRuleMap);
                    let finalCss =
                        this._cssTransformator.getCssFromAst(finalAtfAst);
                    // Minify css
                    finalCss = ccss.minify(finalCss).styles;
                    // Sort media queries
                    finalCss = await postcss([
                        sortMediaQueries({
                            sort: "mobile-first", // default
                        }),
                    ]).process(finalCss, { from: undefined }).css;

                    // Handle restCSS
                    let finalRestCss = "";
                    if (this.options.outputRemainingCss) {
                        debug(
                            "getCriticalCssFromUrls - Filter duplicates of restMap"
                        );
                        // Iterate over atfRules to remove them from restRules
                        for (const [atfRuleKey, atfRuleObj] of atfRuleMap) {
                            // Check if ruleKey exists in restMap
                            // If not it is only in atfMap. This is the wanted behaviour
                            if (restRuleMap.has(atfRuleKey)) {
                                // Get the rules array for the rule key
                                let restRuleArr = restRuleMap.get(atfRuleKey);
                                // RestMap has the same ruleKey as atf. We need to check now if the rules in this key match
                                // But before we divide between media rules and rules
                                restRuleArr = restRuleArr.filter(
                                    (ruleObj) =>
                                        !atfRuleObj.some(
                                            (atfRule) =>
                                                ruleObj.hash === atfRule.hash
                                        )
                                );
                                if (restRuleArr.length > 0) {
                                    restRuleMap.set(atfRuleKey, restRuleArr);
                                } else {
                                    restRuleMap.delete(atfRuleKey);
                                }
                            }
                        }
                        debug(
                            "getCriticalCssFromUrls - Filter duplicates of restMap - finished"
                        );

                        let finalRestAst = Ast.getAstOfRuleMap(restRuleMap); // Create an AST object of a crittr rule map
                        finalRestCss =
                            this._cssTransformator.getCssFromAst(finalRestAst); // Transform AST back to css
                        finalRestCss = ccss.minify(finalRestCss).styles; // remove and merge remaining dupes
                        // Resort media queries.
                        finalRestCss = await postcss([
                            sortMediaQueries({
                                sort: "mobile-first", // default
                            }),
                        ]).process(finalRestCss, { from: undefined }).css;
                    }

                    resolve([finalCss, finalRestCss, errors]);
                })
                .catch((err) => {
                    reject(err);
                });
        }); // End of Promise
    }

    /**
     * Evaluates an url and returns the critical AST Object
     *
     * @param url
     * @param sourceAst
     * @returns {Promise<Object>}
     */
    evaluateUrl(url, sourceAst) {
        return new Promise(async (resolve, reject) => {
            let retryCounter = 3;
            let hasError = false;
            let page = null;
            let criticalSelectorsMap = new Map();
            let criticalAstObj = null;
            let restAstObj = null;

            const getPage = async () => {
                return new Promise((resolve, reject) => {
                    try {
                        this.getPage()
                            .then((page) => {
                                resolve(page);
                            })
                            .catch((err) => {
                                if (retryCounter-- > 0) {
                                    log.warn(
                                        "Could not get page from browser. Retry " +
                                            retryCounter +
                                            " times."
                                    );
                                    resolve(getPage());
                                } else {
                                    log.warn(
                                        "Tried to get page but failed. Abort now ..."
                                    );
                                    reject(err);
                                }
                            });
                    } catch (err) {
                        reject(err);
                    }
                });
            };

            try {
                debug("evaluateUrl - Open new Page-Tab ...");
                page = await getPage();
                if (this.options.printBrowserConsole === true) {
                    page.on("console", (msg) => {
                        const args = msg.args();
                        for (let i = 0; i < args.length; ++i)
                            log.log(`${args[i]}`);
                    });

                    page.on("pageerror", (err) => {
                        log.log("Page error: " + err.toString());
                    });

                    page.on("error", (err) => {
                        log.log("Error: " + err.toString());
                    });
                }
                debug("evaluateUrl - Page-Tab opened!");
            } catch (err) {
                debug("evaluateUrl - Error while opening page tab -> abort!");
                hasError = err;
            }

            // Set Page properties
            if (hasError === false) {
                try {
                    let browserOptions = this.options.browser;
                    let deviceOptions = this.options.device;
                    debug("evaluateUrl - Set page properties ...");
                    await page.setCacheEnabled(browserOptions.isCacheEnabled); // Disables cache
                    await page.setJavaScriptEnabled(browserOptions.isJsEnabled);
                    //                await page.setExtraHTTPHeaders("");
                    await page.setRequestInterception(true);

                    const blockRequests = this.options.blockRequests;

                    // Remove tracking from pages (at least the well known ones
                    page.on("request", (interceptedRequest) => {
                        const url = interceptedRequest.url();
                        if (blockRequests) {
                            for (const blockedUrl of blockRequests) {
                                if (url.includes(blockedUrl)) {
                                    interceptedRequest.abort();
                                    return;
                                }
                            }
                        }
                        interceptedRequest.continue();
                    });

                    // For DEBUG reasons
                    //                    page.on('load', () => {
                    //                        debug("EVENT: load - triggered for " + page.url());
                    //                    });

                    //                    page.on('requestfailed', request => {
                    //                        startedRequests.splice(startedRequests.indexOf(request.url()), 1);
                    //                    });
                    //
                    //                    page.on('requestfinished', request => {
                    //                        startedRequests.splice(startedRequests.indexOf(request.url()), 1);
                    //                    });

                    page.on("error", (err) => {
                        hasError = err;
                    });

                    await page.emulate({
                        viewport: {
                            width: deviceOptions.width,
                            height: deviceOptions.height,
                            deviceScaleFactor: deviceOptions.scaleFactor,
                            isMobile: deviceOptions.isMobile,
                            hasTouch: deviceOptions.hasTouch,
                            isLandscape: deviceOptions.isLandscape,
                        },
                        userAgent: browserOptions.userAgent,
                    });

                    debug("evaluateUrl - Page properties set!");
                } catch (err) {
                    debug(
                        "evaluateUrl - Error while setting page properties -> abort!"
                    );
                    hasError = err;
                }
            }

            // Go to destination page
            if (hasError === false) {
                // TODO: handle goto errors with retry
                try {
                    debug("evaluateUrl - Navigating page to " + url);

                    // CHeck if url is local or web
                    if (this.isLocalFile(url)) {
                        // Clear file url from parameters because we don't need them
                        if (url.includes("?")) {
                            url = url.substring(0, url.indexOf("?"));
                        }
                        if (url.includes("#")) {
                            url = url.substring(0, url.indexOf("#"));
                        }

                        const htmlContent = await fs.readFile(
                            path.join(global.crittr_project_path, url),
                            "utf8"
                        );
                        await page.setContent(htmlContent);
                    } else {
                        await page.goto(url, {
                            timeout: this.options.timeout,
                            waitUntil: ["networkidle2"],
                        });
                    }

                    debug("evaluateUrl - Page navigated");
                } catch (err) {
                    debug("evaluateUrl - Error while page.goto -> " + url);
                    hasError = err;
                }
            }

            if (hasError === false) {
                try {
                    debug("evaluateUrl - Extracting critical selectors");
                    await page.waitForTimeout(250); // Needed because puppeteer sometimes isn't able to handle quick tab openings
                    if (this.options.takeScreenshots === true) {
                        const screenName =
                            url.replace(/[^\w\s]/gi, "_") + ".png";
                        await page.screenshot({
                            path: path.join(
                                this.options.screenshotPath,
                                screenName
                            ),
                            type: "png",
                        });
                    }
                    criticalSelectorsMap = new Map(
                        await page.evaluate(extractCriticalCss_script, {
                            sourceAst: sourceAst,
                            loadTimeout: this.options.pageLoadTimeout,
                            keepSelectors: this.options.keepSelectors,
                            removeSelectors: this.options.removeSelectors,
                            dropKeyframes: this.options.dropKeyframes,
                        })
                    );
                    debug(
                        "evaluateUrl - Extracting critical selectors - successful! Length: " +
                            criticalSelectorsMap.size
                    );
                } catch (err) {
                    debug(
                        "evaluateUrl - Error while extracting critical selectors -> not good!"
                    );
                    hasError = err;
                }

                debug("evaluateUrl - cleaning up AST with criticalSelectorMap");
                const [criticalAst, restAst] =
                    this._cssTransformator.filterByMap(
                        sourceAst,
                        criticalSelectorsMap
                    );
                criticalAstObj = criticalAst;
                restAstObj = restAst;
                debug(
                    "evaluateUrl - cleaning up AST with criticalSelectorMap - END"
                );
            }

            if (hasError === false) {
                try {
                    debug("evaluateUrl - Closing page ...");
                    await page.close();
                    debug("evaluateUrl - Page closed");
                } catch (err) {
                    hasError = err;
                    debug(
                        "evaluateUrl - Error while closing page -> already closed?"
                    );
                }
            }

            // Error handling
            if (hasError !== false) {
                try {
                    await this.gracefulClosePage(page, hasError);
                } catch (err) {}
                reject(hasError);
            }

            resolve([criticalAstObj, restAstObj]);
        });
    }

    isLocalFile(url) {
        let isLocalFile = true;

        try {
            const tmpUrl = new URL(url);
            debug(`{url} is a real url`);
            isLocalFile = false;
        } catch (e) {
            debug(`{url} is a local file`);
        }

        return isLocalFile;
    }
}

module.exports = Crittr;
