const judge = require("../dist");
const { join } = require("path");

console.log("Start test...");

judge(
    {
        id: 1000
    },
    {
        file: 1,
        language: "cpp11"
    },
    (id) => ({
        path: join(__dirname, "" + id),
        info: {}
    }),
    (solution) => console.log(solution)
);