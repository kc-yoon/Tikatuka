// Runs the hard AI search off the main thread. See AIWorkerClient in game.js.
importScripts('ai.js');

onmessage = (e) => {
  const { id, kind, args } = e.data;
  postMessage({ id, result: runAIJob(kind, args) });
};
