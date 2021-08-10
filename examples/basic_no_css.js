"use strict";
const path    = require('path');
const fs      = require('fs-extra');
const Crittr  = require('../index');
const rootDir = path.join(__dirname, "..");


Crittr({
    urls:   [
        "https://github.com"
    ],
    device: {
        width:  1920,
        height: 1080
    }
}).then( ({critical, rest}) => {
    fs.writeFileSync(path.join(rootDir, "./examples/basic_no_css.css"), critical, "utf-8")
}).catch(err => {
    console.error(err);
});

