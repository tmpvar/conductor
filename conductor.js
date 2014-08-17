/*jslint white: true, onevar: true, undef: true, eqeqeq: true, bitwise: true, regexp: true, newcap: true, immed: true, indent: 2*/
/*global setTimeout: true, window: true, exports: true */
/*
Copyright (c) 2010 Tim Caswell  < tim@creationix>, Elijah Insua  < tmpvar@gmail.com>

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
*/

(function (exports) {
  "use strict";

  // id for context nodes
  var contextIndex = 0;


  // hang everything off of conductor
  if (!exports) {
    exports = module.exports = conductor;
  } else {
    exports.conductor = conductor;
    exports = conductor;
  }


  function conductor() {
    var conductor = {
      nodes  : [],
      node   : function (fn, name) {
        return new Node(fn, conductor, name);
      },
      listeners : {},
      on : function(name, fn) {
        if (!conductor.listeners[name]) {
          conductor.listeners[name] = [];
        }
        conductor.listeners[name].push(fn);
      }
    };
    conductor.execute = new Executor(conductor);
    return conductor;
  };

  conductor.Context = Context;
  conductor.Edge = Edge;
  conductor.Executor = Executor;
  conductor.Node = Node;
  conductor.Port = Port;

  /*
    Context is a means for tracking parallel execution flows and it provides
    a way to fork and join a flow.  Forks and Joins are tracked by using a
    tree that corresponds to nodes that have been executed.
  */
  function Context(parent, forkNode, conductor, disableEmit) {
    this.parent = parent || null;
    this.forkNode = (forkNode === true);
    this.id = contextIndex++;
    this.nodes = {};
    this.forks = [];


    if ((parent && parent.emit === false) || disableEmit) {
      this.emit = false;
    } else if (parent && parent.emit) {
      this.emit = parent.emit;
    } else if (conductor) {
      this.emit = function(name, data) {
        if (conductor.listeners[name]) {
          var i, listener;
          for (i=0; i<conductor.listeners[name].length; i++) {
            listener = conductor.listeners[name][i];
            if (typeof listener === 'function') {
              listener(name, data);
            }
          }
        }

        if (conductor.listeners['*']) {
          var i, listener;
          for (i=0; i<conductor.listeners['*'].length; i++) {
            listener = conductor.listeners['*'][i];
            if (typeof listener === 'function') {
              listener(name, data);
            }
          }
        }
      };
      conductor.emit = this.emit;
    }

    if (this.emit) { this.emit("context.new.start", this); }
        // Automatically initialize this context with the incoming parent Context
    this.init(parent);
    if (this.emit) { this.emit("context.new.end", this); }
  };

  Context.prototype = {
    // Initialize this Context in regards to its parent (if any)
    init : function (parentContext) {
      if (this.emit) { this.emit("context.init.start", this); }
      // If a parent is passed we need to maintain fork nodes
      if (parentContext) {

        // Add all of the parent's fork ids to this node
        // fork ids are context id's that have their forkNode property set to true
        this.forks = this.forks.concat(parentContext.forks);

        // If the incoming parent is a fork, add it to this Context's fork queue
        if (parentContext.forkNode) {
          this.forks.push(parentContext.id);
        } else if (this.forkNode) {
          this.nodes = this.parent.nodes;
          this.parent.nodes = {};
        }
      }
      if (this.emit) { this.emit("context.init.end", this); }
    },

    // Setup this context to have the outline of edges/ports matching the incoming node.
    // this makes it easier to work with the Context object when manipulating it from
    // the inside of Nodes
    prepare : function (node) {
      // Make sure this Context hasn't already prepared this Node
      if (!this.nodes[node.index]) {
        if (this.emit) { this.emit("context.node.prepare.start", {context: this, node: node}); }
        this.nodes[node.index] = {
          edges    : {},
          executed : false
        };

        var nodes = this.nodes,
            edges = node.edges,
            edge,
            contextNodeEdges = nodes[node.index].edges;

        // Setup all of the Edges/Ports
        for (edge in edges) {
          if (edges.hasOwnProperty(edge)) {
            contextNodeEdges[edge] = contextNodeEdges[edge] || {
              ports : {}
            };
          }
        }

        if (this.emit) { this.emit("context.node.prepare.end", {context: this, node: node}); }
      }
    },

    // Insert this context below the incoming context
    reparent : function (context) {
       if (this.emit) { this.emit("context.reparent.start", {context: this, parent: context}); }
      context.parent = this.parent;
      this.parent = context; // TODO: this probably needs to be initialized.
      this.forks = [];
      this.init(context);
       if (this.emit) { this.emit("context.reparent.end", {context: this, parent: context}); }
    }
};

  /*
    Every node has 3 edges: input, output, and callback.  Each edge is a boundry or
    synchronization point for execution on a particular context.

    In the case of fork nodes, the output edge cannot fire until all the outputs/callbacks are satisfied.
    Synchronization happens on outputs and callbacks because that is the only way to have multiple outputs
    in javascript.

    In the case of join nodes, the input edge must be completely satisfied with values from Contexts that
    share a common fork Context.
  */
  function Edge(node, type) {
    this.type  = type;
    this.ports = {};
    this.node  = node;
  };

  Edge.prototype = {
    length : 0,

    // Mark satisfaction in the current Context, and attempt to trigger this edge
    satisfy : function (context, port, value) {
      if (context.emit) {
        context.emit("edge.satisfy.start", {
          edge   : this,
          context: context,
          port   : port,
          value  : value
        });
      }
      // Ensure the passed context is properly setup before continuing
      context.prepare(this.node);

      // IF this node is a join node, we need to hold onto the value in the specified port
      if (this.node.isJoin()) {
        this.ports[port].enqueue({
          context: context,
          value  : value
        });

      // Otherwise just mark the value in the context, satisfying this port
      } else {
        this.ports[port].value(context, value);
      }

      // If all of the ports in this context are satisfied, attempt to forward the values
      if (this.satisfied(context)) {
        this.trigger(context);
      }

      if (context.emit) {
        context.emit("edge.satisfy.end", {
          edge   : this,
          context: context,
          port   : port,
          value  : value
        });
      }
    },

    // Triggering an edge does different things depending on the edge. Output/Callback edges forward their
    // queued values to their attached ports.  Input edges execute the Node that the edge is associated
    // with.
    trigger : function (context) {
      var i, c, values, edges = this.node.edges;

      if (context.emit) { context.emit("edge.trigger.start", { edge: this, context: context}); }

      // Attempt to forward the values down the pipes to all of the Ports waiting for values from this
      // Node
      if (this.type === "output" || this.type === "callback") {

        var outputPorts = edges.output.ports,
            callbackPorts = edges.callback.ports;
        // Contexts need to be forked at trigger time to ensure a unique id that can be looked up down
        // the line at join time.
        if (this.node.isFork()) {
          context = new Context(context, true);
        }

        // Forward all the output values
        for (i in outputPorts) {
          if (outputPorts.hasOwnProperty(i)) {
            outputPorts[i].forward(context);
          }
        }

        // Forward all of the callback values
        for (c in callbackPorts) {
          if (callbackPorts.hasOwnProperty(c)) {
            callbackPorts[c].forward(context);
          }
        }

      // Execute this node.
      } else if (this.type === "input") {
        this.node.execute(context);
      }
      if (context.emit) { context.emit("edge.trigger.end", { edge: this, context: context}); }
    },

    // Returns an array of values that have been set in the current context
    values : function (context) {
      var ports = [], i, c,
          // Attach a synthetic callback to the incoming port, which allows conductor to pick up the value
          // after its been executed and satisfy the incoming port.
          setupCallback = function (port, index) {
            ports[index] = function (arg) {
              port.edge.satisfy(context, index, arg);
            };
          };

      if (context.emit) { context.emit("edge.values.start", { edge: this, context: context}); }

      // Collect the values of this edge's ports
      for (i in this.ports) {
        if (this.ports.hasOwnProperty(i)) {
          ports[i] = this.ports[i].value(context);
        }
      }

      // Setup synthetic callbacks for all of the callback Edge's ports
      for (c in this.node.edges.callback.ports) {
        if (this.node.edges.callback.ports.hasOwnProperty(c)) {
          setupCallback(this.node.edges.callback.ports[c], c);
        }
      }

      if (context.emit) { context.emit("edge.values.end", { edge: this, context: context, values: ports }); }

      return ports;
    },

    // Satisfaction is determined by both checking the current context for satisfaction of this Edge's
    // Ports, and also by comparing the port queue to the incoming context to see if they share a common
    // Context split ancestor.
    satisfied : function (context) {
      var matches = [], i, j, m;

      if (context.emit) { context.emit("edge.satisfied.start", { edge: this, context: context}); }

      // Ensure this Context is setup to handle this Node.
      context.prepare(this.node);

      // Don't bother with the processing if there are no ports to satisfy.
      if (this.length === 0) {
        if (context.emit) { context.emit("edge.satisfied.end", { edge: this, context: context, result: true }); }
        return true;
      }

      // If this is a join Node it's ports need to be checked for an entry that matches one of
      // incoming Context's fork queue entries
      if (this.node.isJoin()) {
        for (j in this.ports) {
          // Avoid re-checking ports that are satisfied in this context
          if (!this.ports[j].satisfied(context)) {

            // Test the current Port for a fork queue match
            matches[j] = this.ports[j].match(context);
            if (matches[j] === null) {
              // If a single port is not satisfied, the entire edge cannot be satisfied
              if (context.emit) { context.emit("edge.satisfied.end", { edge: this, context: context, result: false }); }
              return false;
            }
          }
        }

        // This edge, is satisfied.  Now the current context needs the values of all of the other queue'd
        // entries.
        //
        // NOTE: this can only be done after an edge is satisfied, as joining before satisfaction requires
        //       a large amount of machinery to pull the values out of a previously merged context.
        for (m = 0; m < matches.length; m++) {
          // merge the value into the current context
          this.ports[m].join(matches[m], context);
        }

      // If this is a straight through node, there is no need to perform match/join on the queue
      } else {
        for (i in this.ports) {
          if (!this.ports[i].satisfied(context)) {
            if (context.emit) { context.emit("edge.satisfied.end", { edge: this, context: context, result: false }); }
            return false;
          }
        }
      }
      if (context.emit) { context.emit("edge.satisfied.end", { edge: this, context: context, result: true }); }
      return true;
    },

    addPort : function(index) {
      if (!this.ports[index]) {
        this.ports[index] = new Port(this, index);
        this.length += 1;
      }
      return this.ports[index];
    },

    // This is an internal method to setup a route from a port on the current Edge to another port. This
    // connection is described as a "pipe" internally.
    route : function (index, port) {
      // When no port is passed, this method acts as a getter
      if (!port) {
        // If the port thats being queried does not exist, create it
        return this.addPort(index);
      }

      // Passing an input into an input means "callback"
      if (this.type === "input" && port.edge.type === "input") {
        return this.node.callback(index, port);
      }

      // If the port in question does not exist, create it
      this.addPort(index)

      // Wrap callbacks with a new node and attach to the appropriate port on this Edge
      if (this.type === "output" && typeof port === 'function') {
        var tmp = new Node(port, this.node.conductor);
        tmp.name = this.node.name + " -> callback";

        // Create a pipe between this node's output and the temporary node's input
        this.node.output(tmp.input(0));
        port = tmp.input(0);
      }

      // Add the incoming port to the selected port's pipes
      this.ports[index].pipes.push(port);

      // Add the selected port to the incoming port's pipes
      port.pipes.push(this.ports[index]);

      return this.ports[index];
    }
  };

  // Executor kicks off a a flow in a new (parentless) context
  function Executor(conductor, context) {
    var self = this;
    context = new Context(context, false, conductor, true);

    // Make every flow asynchronous by way of setTimeout(..., 0)
    var queue = function (node) {
      if (context.emit) { context.emit("executor.queue.start", { executor: self, context: context, node: node }); }
      process.nextTick(function () {
        if (context.emit) { context.emit("executor.dequeue.start", { executor: self, context: context, node: node }); }

        // Setup the context
        var initContext = new Context(context);
        initContext.prepare(node);

        // Execute the node
        node.execute(initContext);

        if (context.emit) { context.emit("executor.dequeue.end", { executor: self, context: context, node: node }); }
      });
      if (context.emit) { context.emit("executor.queue.end", { executor: self, context: context, node: node }); }
    };

    // Run the flow!
    return function execute() {
      if (context.emit) { context.emit("executor.execute.start", { executor: self, context: context}); }
      var i = 0, l = conductor.nodes.length;
      for (i; i < l; i++) {
        queue(conductor.nodes[i]);
      }
      if (context.emit) { context.emit("executor.execute.end", { executor: self, context: context }); }
    };
  };

  // Node provides a wrapper for functionality and Edges.
  function Node(fn, conductor, name) {
    var self = this;

    // Every node in this flow gets attached to the conductor instance
    this.conductor = conductor;
    conductor.nodes.push(this);

    // If the incoming fn is a function, make it easier for humans to
    // attach inputs and such.
    if (typeof fn === "function") {
      // Get the string representation of a function and collect the arguments
      var str     = fn.toString().replace(/\r/g,""), matches,
          fns = str.split("\n");

          for (var i=0; i<fns.length; i++) {
            fns[i] = fns[i].replace(/\/\/.*$/g,"");
          }
          str = fns.join("");
          var start = str.indexOf("/*"), end;
          while (start >= 0) {
              end = str.indexOf("*/");
              str = str.substring(start, (start-end)+2) + str.substring(end+2);
              start = str.indexOf("/*");
          }

          str = str.replace(/[\r\n ]/g, '');
          str = str.replace(/\/\*.*\*\//g,"");
          matches = str.match(/function[^\(]*\(([^\)]*)\)/);


      // If there are arguments
      if (matches && matches.length === 2) {
        // split them apart
        var args = matches[1].replace(/[\n \t]*/g,"").split(",");
        this.args = {};
        var setupArg = function(index, name) {
          self.args[name] = function(port) {
            return self.input(index, port);
          }
        }

        // add the args as wrappers around Node.input()
        for (var i=0; i<args.length; i++) {
          var arg = args[i];
          setupArg(i, arg);
        }
      }
    }

    // Every node in this flow gets a unique identifier
    this.index = conductor.nodes.length - 1;

    // the Node's name is the index if a name is not passed
    this.name = name || this.index;


    // Prepare 3 (for now) edges in which data can flow through
    this.edges = {
      input : new Edge(this, "input"),
      output: new Edge(this, "output"),
      callback: new Edge(this, "callback")
    };

    // Ease of use wrapper for the input edge route method
    this.input = function (index, port) {
      return this.edges.input.route(index, port);
    };

    // Ease of use wrapper for the output edge route method
    this.output = function (port) {
      return this.edges.output.route(0, port);
    };

    // Ease of use wrapper for the callback edge route method
    this.callback = function (index, port) {
      return this.edges.callback.route(index, port);
    };

    // This method returns true when the number of inputs is greater than one which means
    // there are multiple sources "joining" at this node.
    this.isJoin = function () {
      return (this.edges.input.length > 1);
    };

    // This method returns true if the number of outputs + callbacks is greater than 1.  The reason for
    // this is: it is impossible to have multiple outputs if not by callbacks (or events)
    this.isFork = function () {
      return (this.edges.callback.length > 1 ||
              this.edges.callback.length + this.edges.output.length > 1);
    };

    // Execute the function that this node wraps.
    this.execute = function (context) {
      if (context.emit) { context.emit("node.execute.queue.start", { node: this, context: context }); }

      // As edges are boundries, the input edge needs to be satisfied before continuing.
      if (this.edges.input.satisfied(context) && typeof fn === "function") {
        var edge = this.edges.input,
            values = edge.values(context);

        // Asynchronously execute the function
        process.nextTick(function () {
          if (context.emit) { context.emit("node.execute.perform.start", { node: this, context: context }); }
          var result = fn.apply(context, values);
          // The only output you can actually have is a return.. everything else
          // is callback based.  The only reason we'd need to satisfy it is if it's
          // required in the current flow.
          if (self.edges.output.length > 0) {
            self.edges.output.satisfy(context, 0, result);
          }
          if (context.emit) { context.emit("node.execute.perform.end", { node: this, context: context }); }
        });
      }

      if (context.emit) { context.emit("node.execute.queue.end", { node: this, context: context }); }
    };
  };

  /*
    Ports are the inlets/outlets in conductor.
  */
  function Port(edge, index) {
    this.pipes = []; // these are actual routes
    this.edge = edge;
    this.callback = false;
    this.index = index;
    this.queue = [];
    edge.ports[index] = this;

    // contextual getter/setter
    this.value = function (context, val) {
      var port = this.index,
          type = this.edge.type,
          node = this.edge.node.index;

      context.prepare(this.edge.node);

      // Setter mode
      if (arguments.length === 2) {
        if (context.emit) { context.emit("port.value.set.start", { port: this, context: context, value: val }); }
        if (context.nodes[node].edges[type].ports) {
          // Set the value in the context
          context.nodes[node].edges[type].ports[port] = {
            value     : val,
            satisfied : true
          };
        }
        if (context.emit) { context.emit("port.value.set.end", { port: this, context: context, value: val }); }
      }

      // The port is set, return its value
      if (context.nodes[node].edges[type].ports[port]) {
        if (context.emit) { context.emit("port.value.get.start", { port: this, context: context }); }
        var value =  context.nodes[node].edges[type].ports[port].value;
        if (context.emit) { context.emit("port.value.get.end", { port: this, context: context, value: value }); }
        return value;
      }
    };

    // Ports are satisfied when they have an associated value in the provided context
    this.satisfied = function (context) {
      var node = this.edge.node.index,
          type = this.edge.type,
          port = this.index;

      context.prepare(this.edge.node);

      return (context.nodes[node].edges[type].ports[port] &&
              context.nodes[node].edges[type].ports[port].satisfied === true);
    };

    // Contexts are queued on the port's that they satisfy until the entire edge
    // has been satisfied.  This is important for parallel fork/joins
    this.enqueue = function (data) {
      this.queue.push(data);
    };

    // Attempt to find a match between the incoming context and any one of the queue entries' contexts
    this.match = function (context) {
      if (context.emit) { context.emit("port.match.start", { port: this, context: context }); }
      var i, c, currentQueueItem = this.queue.length, currentFork;
      while (currentQueueItem--) {

        // If the incoming context is the same as the current queue item's context, then we have a match
        if (this.queue[currentQueueItem].context === context) {
          if (context.emit) { context.emit("port.match.end", { port: this, context: context, result: currentQueueItem }); }
          return currentQueueItem;
        }

        // Attempt to match the queue items against the current context's fork queue
        currentFork = this.queue[currentQueueItem].context.forks.length;
        while(currentFork--) {
          // Does this queue context and the current context have a common fork context ancestor?
          if (context.forks.indexOf(this.queue[currentQueueItem].context.forks[currentFork]) !== -1) {
            if (context.emit) { context.emit("port.match.end", { port: this, context: context, result: currentQueueItem }); }
            return i;
          }
        }
      }
      if (context.emit) { context.emit("port.match.end", { port: this, context: context, result: null }); }
      return null;
    };

    // Combine the value of specified queue with the values of the specified Context.  Remove the item
    // in the queue when complete.
    this.join = function (queueIndex, context) {
      if (context.emit) { context.emit("port.join.start", { port: this, context: context, index: queueIndex }); }
      var data = this.queue[queueIndex];
      this.queue.splice(queueIndex, 1);
      this.value(context, data.value);
      if (context.emit) { context.emit("port.join.end", { port: this, context: context, index: queueIndex, data: data }); }
    };

    // Forward the value for this port (located in the incoming Context) down all of this port's pipes.
    // This is done by satisfying all of the target port's with the value.
    this.forward = function (context) {
      if (context.emit) { context.emit("port.forward.start", { port: this, context: context }); }
      var forwarded = {}, p = this.pipes.length, target, targetStr;
      // Satisfy the downstream ports
      while(p--) {
        target       = this.pipes[p];
        targetStr    = target.edge.node.index + "@" +
                           target.edge.type + "#" + target.index;

        // Don't forward to the same port more than once
        if (!forwarded[targetStr]) {
          // satisfy the target end
          target.edge.satisfy(context, target.index, this.value(context));
          forwarded[targetStr] = true;
        }
      }
      if (context.emit) { context.emit("port.forward.end", { port: this, context: context }); }
    };
  };

// Browser/CommonJS compat
}((typeof exports === "undefined") ? window : null));
