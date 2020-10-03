process.on("unhandledRejection", (err) => {
  throw err;
});

const assert = require("@brillout/assert");
global.assert = assert;

const { resolve: pathResolve } = require("path");
const WildcardApi = require("@wildcard-api/server/WildcardApi");
const WildcardClient = require("@wildcard-api/client/WildcardClient");

const bundle = require("./browser/bundle");
const launchBrowser = require("./browser/launchBrowser");

const staticDir = pathResolve(__dirname + "/browser/dist/");

const {
  symbolSuccess,
  symbolError,
  colorError,
} = require("@brillout/cli-theme");
const chalk = require("chalk");

/*
const DEBUG = true;
/*/
const DEBUG = false;
//*/

const httpPort = 3442;

(async () => {
  await bundle();

  const { browserEval: browserEval_org, browser } = await launchBrowser();
  let browserEval = browserEval_org.bind(null, httpPort);

  const { standardTests, integrationTests } = getTests();

  await runStandardTests({ standardTests, browserEval });

  await runIntegrationTests({ integrationTests, browserEval });

  await browser.close();

  console.log(chalk.bold.green("All tests successfully passed."));
})();

async function runStandardTests({ standardTests, browserEval }) {
  const wildcardApiHolder = {};

  const serverFrameworks = getSelectedTest()
    ? ["express"]
    : ["getApiHttpResponse", "express", "koa", "hapi"];

  for (let serverFramework of serverFrameworks) {
    let stop;
    const _startServer = require("./servers/" + serverFramework);
    const startServer = async (args) => {
      stop = await _startServer({
        wildcardApiHolder,
        httpPort,
        staticDir,
        ...args,
      });
    };
    await startServer();

    for (let test of standardTests) {
      const wildcardApi = new WildcardApi();
      wildcardApiHolder.wildcardApi = wildcardApi;
      const wildcardClient = new WildcardClient();
      wildcardClient.__INTERNAL__wildcardApi = wildcardApi;

      const testArgs = {
        wildcardApi,
        wildcardClient,
        WildcardClient,
        browserEval,
        httpPort,
      };

      await runTest({ test, testArgs, serverFramework });
    }

    await stop();
  }
}

async function runTest({
  test: { testFn, testFile },
  serverFramework,
  testArgs,
}) {
  const testName =
    "[" + serverFramework + "] " + testFn.name + " (" + testFile + ")";

  const log_collector = new LogCollector({ silenceLogs: !DEBUG });
  log_collector.enable();
  const { stdoutLogs, stderrLogs } = log_collector;

  let stderrContent;
  try {
    await testFn({ ...testArgs, assertStderr: (c) => (stderrContent = c) });
    await checkStderr({ stderrContent, stderrLogs });
    assert(noStdoutSpam(stdoutLogs), { stdoutLogs });
  } catch (err) {
    log_collector.flush();
    log_collector.disable();

    console.log(colorError(symbolError + "Failed test: " + testName));

    throw err;
  }
  log_collector.disable();

  console.log(symbolSuccess + testName);

  return;
}

async function checkStderr({ stderrContent, stderrLogs }) {
  if (stderrContent === undefined) {
    return;
  }

  // Express seems to rethrow errors asyncronously; we need to wait for express to rethrow errors.
  await new Promise((r) => setTimeout(r, 0));

  stderrLogs = removeHiddenLog(stderrLogs);

  const stderrLogsLength = stderrLogs.length;
  assert(stderrLogsLength === 1, { stderrLogsLength, stderrLogs });
  const stderrLog = stderrLogs[0];
  assert(stderrLog.includes(stderrContent), { stderrLog });
  //assert(stderrLogs.find((log) => log.includes(content), { stderrLogsLength, stderrLogs });
}

function noStdoutSpam(stdoutLogs) {
  stdoutLogs = removeHiddenLog(stdoutLogs);

  if (stdoutLogs.length === 0) {
    return true;
  }

  if (stdoutLogs.length === 1) {
    return (
      // Browser-side puppeteer log when endpoint failed
      stdoutLogs[0] ===
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)\n"
    );
  }

  return false;
}

function removeHiddenLog(stdLogs) {
  const [last, ...rest] = stdLogs.slice().reverse();
  // Puppeteer "hidden" log (never saw such hidden log before; I don't know how and why this exists)
  if (
    last &&
    last.includes(
      "This conditional evaluates to true if and only if there was an error"
    )
  ) {
    stdLogs = rest;
  }
  return stdLogs;
}

async function runIntegrationTests({ integrationTests, browserEval }) {
  for (test of integrationTests) {
    const testArgs = { browserEval, staticDir, httpPort };
    await runTest({ test, testArgs, serverFramework: "custom-server" });
  }
}

function getTests() {
  const glob = require("glob");
  const path = require("path");

  const projectRoot = __dirname + "/..";

  const selectedTest = getSelectedTest();

  const testFiles = glob.sync(projectRoot + "/tests/*.js");
  const standardTests = [];
  const integrationTests = [];
  testFiles.forEach((filePath) => {
    require(filePath).forEach((testFn) => {
      const testFile = path.relative(projectRoot, filePath);
      const args = { testFile, testFn };
      if (!selectedTest || selectedTest === testFn.name) {
        if (testFn.isIntegrationTest) {
          integrationTests.push(args);
        } else {
          standardTests.push(args);
        }
      }
    });
  });

  return { standardTests, integrationTests };
}
function getSelectedTest() {
  return getCLIArgument();
}
function getCLIArgument() {
  assert([2, 3].includes(process.argv.length));
  return process.argv[2];
}

function LogCollector({ silenceLogs }) {
  assert([true, false].includes(silenceLogs));

  let stdout_write;
  let stderr_write;
  const stdout_write_calls = [];
  const stderr_write_calls = [];

  const stdoutLogs = [];
  const stderrLogs = [];

  return { enable, disable, flush, stdoutLogs, stderrLogs };

  function enable() {
    stdout_write = process.stdout.write;
    stderr_write = process.stderr.write;
    process.stdout.write = (...args) => {
      if (!silenceLogs) {
        stdout_write.apply(process.stdout, args);
      }
      stdout_write_calls.push(args);
      stdoutLogs.push(...args.map((o) => o.toString()));
    };
    process.stderr.write = (...args) => {
      if (!silenceLogs) {
        stderr_write.apply(process.stderr, args);
      }
      stderr_write_calls.push(args);
      stderrLogs.push(...args.map((o) => o.toString()));
    };
  }
  function disable() {
    process.stdout.write = stdout_write;
    process.stderr.write = stderr_write;
  }
  function flush() {
    if (!silenceLogs) {
      return;
    }
    stdout_write_calls.forEach((args) =>
      stdout_write.apply(process.stdout, args)
    );
    stderr_write_calls.forEach((args) =>
      stderr_write.apply(process.stderr, args)
    );
  }
}
