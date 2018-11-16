"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const puppeteer_1 = require("puppeteer");
const interfaces_1 = require("./interfaces");
const MAX_SOURCE_SIZE = 16 * 1024 * 1024;
const UPDATE_INTERVAL = 1000;
const config = JSON.parse(fs_1.readFileSync("config.json").toString());
let browser = null;
const isLoggedIn = async () => {
    if (!browser) {
        return false;
    }
    const page = await browser.newPage();
    try {
        const res = await page.goto("http://acm.hdu.edu.cn/control_panel.php");
        const failed = !(/My Control Panel/.test(await res.text()));
        await page.close();
        return !failed;
    }
    catch (e) {
        await page.close();
        return false;
    }
};
const initRequest = async () => {
    console.log("[INFO] [HDU] Puppeteer is initializing");
    browser = await puppeteer_1.launch({ headless: false });
    const page = await browser.newPage();
    try {
        await page.goto("http://acm.hdu.edu.cn/");
        await page.evaluate((username, password) => {
            const usr = document.querySelector("body > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(5) > form > table > tbody > tr:nth-child(2) > td:nth-child(2) > input");
            const pwd = document.querySelector("body > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(5) > form > table > tbody > tr:nth-child(3) > td:nth-child(2) > input");
            usr.value = username;
            pwd.value = password;
            const btn = document.querySelector("body > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(5) > form > input");
            btn.click();
        }, config.username, config.password);
        await page.waitForNavigation();
        if (!await isLoggedIn()) {
            throw new Error("Login failed");
        }
        await page.close();
        console.log("[INFO] [HDU] Puppeteer is initialized");
    }
    catch (e) {
        await page.close();
        throw e;
    }
};
const submit = async (id, code, langcode) => {
    const page = await browser.newPage();
    try {
        await page.goto("http://acm.hdu.edu.cn/submit.php?pid=" + id);
        await page.evaluate((lang, sourcecode) => {
            const langEle = document.querySelector("body > table > tbody > tr:nth-child(4) > td > form > table > tbody > tr:nth-child(4) > td > span > select");
            const codeEle = document.querySelector("body > table > tbody > tr:nth-child(4) > td > form > table > tbody > tr:nth-child(6) > td > textarea");
            langEle.value = lang;
            codeEle.value = sourcecode;
            const btn = document.querySelector("body > table > tbody > tr:nth-child(4) > td > form > table > tbody > tr:nth-child(7) > td > input:nth-child(2)");
            btn.click();
        }, langcode, code);
        await page.waitForNavigation();
        const unparsedID = await page.evaluate((username) => {
            const tbody = document.querySelector("#fixed_table > table > tbody");
            for (let i = 2; i < tbody.children.length; i++) {
                const tr = tbody.children[i];
                const user = tr.children[8].textContent.trim();
                if (user === username) {
                    return tr.children[0].textContent.trim();
                }
            }
            return null;
        }, config.username);
        if (unparsedID === null) {
            throw new Error("Submit failed");
        }
        await page.close();
        return parseInt(unparsedID, 10);
    }
    catch (e) {
        await page.close();
        throw e;
    }
};
const updateMap = new Map();
const convertStatus = (status) => {
    switch (status) {
        case "Queuing":
            return interfaces_1.SolutionResult.WaitingJudge;
        case "Compiling":
        case "Running":
            return interfaces_1.SolutionResult.Judging;
        case "Accepted":
            return interfaces_1.SolutionResult.Accepted;
        case "Presentation Error":
            return interfaces_1.SolutionResult.PresentationError;
        case "Time Limit Exceeded":
            return interfaces_1.SolutionResult.TimeLimitExceeded;
        case "Memory Limit Exceeded":
            return interfaces_1.SolutionResult.MemoryLimitExceeded;
        case "Wrong Answer":
            return interfaces_1.SolutionResult.WrongAnswer;
        case "Runtime Error":
            return interfaces_1.SolutionResult.RuntimeError;
        case "Compilation Error":
            return interfaces_1.SolutionResult.CompileError;
    }
    return interfaces_1.SolutionResult.OtherError;
};
const fetch = async (runID) => {
    const page = await browser.newPage();
    try {
        await page.goto("http://acm.hdu.edu.cn/viewcode.php?rid=" + runID);
        const { statusText } = await page.evaluate(() => {
            const sEle = document.querySelector("body > table > tbody > tr:nth-child(6) > td > div > div:nth-child(1) > b > font > font:nth-child(2)");
            return { statusText: sEle.textContent.trim() };
        });
        const status = convertStatus(statusText);
        const score = status === interfaces_1.SolutionResult.Accepted ? 100 : 0;
        const result = {
            status,
            score,
            details: {},
        };
        await page.close();
        return result;
    }
    catch (e) {
        await page.close();
        throw e;
    }
};
const updateSolutionResults = async () => {
    for (const [runid, cb] of updateMap) {
        try {
            const result = await fetch(runid);
            cb(result);
            if (result.status !== interfaces_1.SolutionResult.Judging && result.status !== interfaces_1.SolutionResult.WaitingJudge) {
                updateMap.delete(runid);
            }
        }
        catch (e) {
            cb({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
        }
    }
    setTimeout(updateSolutionResults, UPDATE_INTERVAL);
};
const main = async (problem, solution, resolve, update) => {
    if (interfaces_1.Problem.guard(problem)) {
        if (interfaces_1.Solution.guard(solution)) {
            if (!browser) {
                try {
                    await initRequest();
                }
                catch (e) {
                    browser = null;
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: e.message } });
                }
            }
            try {
                let langcode = null;
                if (solution.language === "c") {
                    langcode = 1;
                }
                else if (solution.language === "cpp11") {
                    langcode = 0;
                }
                else if (solution.language === "java") {
                    langcode = 5;
                }
                else if (solution.language === "csharp") {
                    langcode = 6;
                }
                if (langcode === null) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Language rejected" } });
                }
                const source = await resolve(solution.file);
                const stat = fs_1.statSync(source.path);
                if (stat.size > MAX_SOURCE_SIZE) {
                    return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "File is too big" } });
                }
                const content = fs_1.readFileSync(source.path).toString();
                const runID = await submit(problem.id, content, langcode);
                updateMap.set(runID, update);
            }
            catch (e) {
                return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
            }
        }
        else {
            return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid solution" } });
        }
    }
    else {
        return update({ status: interfaces_1.SolutionResult.JudgementFailed, score: 0, details: { error: "Invalid problem" } });
    }
};
module.exports = main;
updateSolutionResults();
//# sourceMappingURL=index.js.map