const {Worker} = require("worker_threads");
const {LEAGUES} = require("./src/helpers/constants");

function runWorker(league) {
    return new Promise((resolve, reject) => {
        const worker = new Worker("./worker.js", {
            workerData: {league}
        });

        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
            if (code !== 0) reject(new Error(`❌ Worker stopped with exit code ${code}`));
        });
    });
}

(async () => {
    console.log("🚀 Starting parallel scraping...");

    const tasks = LEAGUES.map((league) => runWorker(league));

    const results = await Promise.all(tasks);

    console.log("\n🔥 ALL LEAGUES FINISHED:");
    console.log(results);
})();
