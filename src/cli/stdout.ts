// Imported first by every CLI: when the reader closes the pipe (e.g. `| head`), exit
// quietly instead of crashing with EPIPE.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});
