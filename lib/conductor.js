/*jslint white: true, onevar: true, undef: true, eqeqeq: true, bitwise: true, regexp: true, newcap: true, immed: true, indent: 2 */
/*
Copyright (c) 2010 Tim Caswell <tim@creationix>, Elijah Insua <tmpvar@gmail.com>

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

var undefined,
    conductor = exports.conductor = function() {
      var conductor = {
        nodes  : [],
        node    : function(fn, name) { return new Node(fn, conductor, name); },
      };
      conductor.execute = new Executor(conductor);
      return conductor;
    };

var contextIndex = 0;
var Context = exports.Context = function(parent, splitNode) {
  this.parent = parent || null;
  this.splitNode = (splitNode === true);
  this.id = contextIndex++;
  this.nodes = {};
  this.splits = [];
  var self = this;

  self.init = function(parentContext) {
    // merge splits down the chain
    if (parentContext) {
      for (var i=0; i<parentContext.splits.length; i++) {
        self.splits.push(parentContext.splits[i]);
      }

      // parent was a split, save it off
      if (parentContext.splitNode) {
        self.splits.push(parentContext.id);
      }
    }
  };

  self.prepare = function(node) {
    if (!self.nodes[node.index]) {
      self.nodes[node.index] = {
        edges    : {},
        executed : false
      };

      for (var edge in node.edges) {
        if (node.edges.hasOwnProperty(edge)) {
          if (!self.nodes[node.index].edges[edge]) {
            self.nodes[node.index].edges[edge] = {
              ports : {}
            }
          }
        }
      }
    }
  };

  self.reparent = function(context) {
    context.parent = self.parent;
    self.parent = context;
    self.splits = [];
    self.init(context);
  };

  self.init(parent);
}


function Edge(node, type) {
  this.type  = type;
  this.ports = {};
  this.node  = node;
  this.length = function() {
    var l = 0;
    for (var p in this.ports) {
      if (this.ports.hasOwnProperty(p)) {
        l++;
      }
    }
    return l;
  };
  var self = this;

  this.satisfy = function(context, index, value) {
    context.prepare(node);

    if (self.node.isJoin()) {
      self.ports[index].enqueue({
        context: context,
        value  : value
      });
    } else {
      self.ports[index].value(context, value);
    }

    if (self.satisfied(context)) {
      self.trigger(context);
    }
  };

  this.trigger = function(context) {
    // Attempt to forward the results
    if (self.type === "output" || self.type === "callback") {

      if (self.node.isFork()) {
        context.reparent(new Context(null, true));
      }

      var values = self.values(context);

      for (var i in self.node.edges.output.ports) {
        self.node.edges.output.ports[i].forward(context);
      }

      for (var c in self.node.edges.callback.ports) {
        self.node.edges.callback.ports[c].forward(context);
      }

    } else if (self.type === "input") {
      this.node.execute(context);
    }
  };

  this.values = function(context) {
    var ports = [],
        self  = this;

    for (var i in this.ports) {
      ports[i] = this.ports[i].value(context);
    }

    for (var c in self.node.edges.callback.ports) {
      (function(port, index) {
        ports[c] = function(arg) {
          port.edge.satisfy(context, index, arg);
        };
      })(self.node.edges.callback.ports[c], c);
    }
    return ports;
  };

  this.satisfied = function(context) {
    context.prepare(this.node);
    var ports = context.nodes[node.index].edges[this.type].ports;

    if (this.length() === 0) {
      return true;
    }

    if (this.node.isJoin()) {
      var matches = [];
      for (var j in this.ports) {
        if (!this.ports[j].satisfied(context)) {
          matches[j] = this.ports[j].match(context);i
          if (matches[j] === null) {
            return false;
          }
        }
      }

      for (var m=0; m<matches.length; m++) {
        // a port may have already been satisfied, which means the matches
        // array has gaps
        if (matches[m]) {
          this.ports[m].join(matches[m], context);
        }
      }
    }

    for (var i in this.ports) {
      if (!this.ports[i].satisfied(context)) {
        return false;
      }
    }
    return true;
  };

  // Setup basic routing between one of this edge's ports and another port
  this.route = function(index, port) {
    // Getter
    if (!port) {
      if (!this.ports[index]) {
        self.ports[index] = new Port(self, index);
        return self.ports[index];
      } else {
        return self.ports[index] || null;
      }
    }

    // Setup a new callback
    if (self.type === "input" && port.edge.type === "input") {
      return self.node.callback(index, port);
    }

    if (!self.ports[index]) {
      self.ports[index] = new Port(self, index);
    }

    // Wrap callbacks with a new node and attach to the
    // appropriate port on this Edge
    if (this.type === "output") {
      if (typeof port === 'function') {
        var tmp = new Node(port, self.node.conductor);
        tmp.name = this.node.name + " -> callback";
        tmp.input(0, self.node.output(index));
        port = tmp.input(0);
      }
    }

    self.ports[index].pipes.push(port);
    port.pipes.push(self.ports[index]);
    return self.ports[index];
  };
}


function Executor(conductor, context) {
  context = new Context(context);

  return function execute(fn) {
    var i=0, l=conductor.nodes.length;
    for (i; i<l; i++) {
      (function(node) {
        setTimeout(function() {
          try {
            var initContext = new Context(context);
            initContext.prepare(node);
            node.execute(initContext);
          } catch (e) {
            console.log(e.stack);
          }
        }, 0);
      })(conductor.nodes[i]);
    }

    if (typeof fn === 'function') {
      fn();
    }
  };
}


function Node(fn, conductor, name) {
  // Attach this node to the conductor
  this.conductor = conductor;
  conductor.nodes.push(this);
  this.index = conductor.nodes.length-1;
  this.name = name || this.index;
  var self = this;

  this.edges = {
    input : new Edge(this, "input"),
    output: new Edge(this, "output"),
    callback: new Edge(this, "callback")
  };

  this.input = function(index, port) {
    return this.edges.input.route(index, port);
  };

  this.output = function(port) {
    return this.edges.output.route(0, port);
  };

  this.callback = function(index, port) {
    return this.edges.callback.route(index, port);
  };

  this.isJoin = function() {
    return (this.edges.input.length() > 1);
  };

  this.isFork = function() {
    return (this.edges.callback.length() > 1 ||
            this.edges.callback.length() + this.edges.output.length() > 1);
  };

  this.execute = function(context) {
    if (this.edges.input.satisfied(context) && typeof fn === "function") {
      var edge = this.edges.input,
          values = edge.values(context),
          self = this;

      if (this.isFork()) {
        context.reparent(new Context(null, true));
      }

      setTimeout(function() {
        console.log("EXEC", self.name + "(", values, ")", context.splits);
        var result = fn.apply(context, values);
        // The only output you can actually have is a return.. everything else
        // is callback based
        if (self.edges.output.length() > 0) {
          self.edges.output.satisfy(context, 0, result);
        }
      }, 0);
    }
  };
}


function Port(edge, index) {
  this.pipes = []; // these are actual routes
  this.edge = edge;
  this.callback = false;
  this.index = index;
  this.queue = [];
  edge.ports[index] = this;

  // contextual getter/setter
  this.value = function(context, val) {
    var port = this.index,
        type = this.edge.type,
        node = this.edge.node.index;

    context.prepare(this.edge.node);

    if (arguments.length === 2) {
      if (context.nodes[node].edges[type].ports) {
        context.nodes[node].edges[type].ports[port] = {
          value     : val,
          satisfied : true
        };
      }
    }

    if (context.nodes[node].edges[type].ports[port]) {
      return context.nodes[node].edges[type].ports[port].value;
    }
  };

  this.satisfied = function(context) {
    var node = this.edge.node.index,
        type = this.edge.type,
        port = this.index;

    return (context                         &&
            context.nodes                   &&
            context.nodes[node]             &&
            context.nodes[node].edges[type] &&
            context.nodes[node].edges[type].ports[port]);
  };

  // Contexts are queued on the port's that they satisfy until the entire edge
  // has been satisfied.  This is important for parallel fork/joins
  this.enqueue = function(data) {
    this.queue.push(data);
  };

  this.match = function(context) {
    for (var i=0; i<this.queue.length; i++) {

      if (this.queue[i].context === context) { return i; }

      for (var c=0; c<this.queue[i].context.splits.length; c++) {
        if (context.splits.indexOf(this.queue[i].context.splits[c]) !== -1) {
          return i;
        }
      }
    }
    return null;
  }

  this.join = function(match, context) {
    var data = this.queue[match];
    this.queue.splice(match, 1);
    this.value(context, data.value);

//    if (this.edge.satisfied(context)) {
//      this.edge.trigger(context);
//    }
  }

  this.forward = function(context) {
    var forwarded = [];
    // Satisfy the downstream ports
    for (var p=0; p<this.pipes.length; p++) {
      var target       = this.pipes[p],
          targetStr    = target.edge.node.index + "@" +
                         target.edge.type + "#" + target.index;

      if (forwarded.indexOf(targetStr) === -1) {
        target.edge.satisfy(context, target.index, this.value(context));
        forwarded.push(targetStr);
      }
    }
  };
}
