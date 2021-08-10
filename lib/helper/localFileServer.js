const path = require("path");
const http = require("http");
const fs = require("fs-extra");

const staticServerFunc = (rootPath) => {
    return http.createServer((req, res) => {
        // parse URL

        const parsedUrl = new URL(req.url, "http://localhost:8000");

        // extract URL path
        let pathname = `${rootPath}${parsedUrl.pathname}`;

        // maps file extention to MIME types
        const mimeType = {
            ".ico": "image/x-icon",
            ".html": "text/html",
            ".js": "text/javascript",
            ".json": "application/json",
            ".css": "text/css",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".svg": "image/svg+xml",
            ".pdf": "application/pdf",
            ".doc": "application/msword",
            ".eot": "appliaction/vnd.ms-fontobject",
            ".ttf": "aplication/font-sfnt",
        };
        fs.access(pathname, fs.constants.F_OK, (err) => {
            if (err) {
                // if the file is not found, return 404
                res.statusCode = 404;
                res.end(`File ${pathname} not found!`);
                console.log("404 - FILE NOT FOUND", pathname);
                return;
            }
            // if is a directory, then look for index.html
            if (fs.statSync(pathname).isDirectory()) {
                pathname += "/index.html";
            }
            // read file from file system
            fs.readFile(pathname, (err, data) => {
                if (err) {
                    res.statusCode = 500;
                    res.end(`Error getting the file: ${err}.`);
                    console.log("500 - ERROR GETTING FILE", pathname);
                } else {
                    // based on the URL path, extract the file extention. e.g. .js, .doc, ...
                    const ext = path.parse(pathname).ext;
                    // if the file is found, set Content-type and send data
                    res.setHeader(
                        "Content-type",
                        mimeType[ext] || "text/plain"
                    );
                    res.end(data);
                }
            });
        });
    });
};

module.exports = (rootPath) => {
    const staticServer = staticServerFunc(rootPath);
    staticServer.setTimeout(1000);
    return staticServer;
};
