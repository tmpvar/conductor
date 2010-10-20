var conductor = require("../lib/conductor").conductor,
    http      = require("http"),

    // Create an execution context for this example
    flow      = conductor(),

    // Create a semi-static node that returns a port number
    port      = flow.node(function() { return 8000 }),

    // Create a node that spawns an http server on a specified port, and
    // emits a request/response
    listener  = flow.node(function(port, requestFn, responseFn) {
                  http.createServer(function(req, res) {
                    if (requestFn) {
                      requestFn(req);
                    }
                    if (responseFn) {
                      responseFn(res);
                    }
                  }).listen(port);
                }),

    // Create a node to handle the incoming request (routing/etc)
    handler   = flow.node(function(request) { 
                  return "hello world!\n"
                }),

    // Create a node that will respond to the request
    responder = flow.node(function(body, response) {
                  response.writeHead(200, {'Content-Type': 'text/plain'});
                  response.end(body);
                });

// Route the output of the `port` to the first input of the `listener`
port.output(listener.input(0));

// Route the request to the `handler`'s first input port
listener.input(1, handler.input(0));

// Route the output of the `handler` to the `responder`'s first input
handler.output(responder.input(0))

// Route the `response` from the listener to the second input of the `responder` node
listener.input(2, responder.input(1));

// We now have a flow that looks something like:
//
//      [port]
//       |
//      [listener]
//       |     |
//   [handler] |
//       |     |
//      [responder]
//

// kick off the process
flow.execute();