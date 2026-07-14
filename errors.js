// Error type carried through the app. Thrown by validators and route handlers;
// the central error handler in server.js turns it into a JSON response.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
