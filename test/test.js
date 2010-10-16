var conductor = require("../lib/conductor").conductor,
    Context   = require("../lib/conductor").Context;

var tests   = [],
    pass    = 0,
    fail    = 0,
    execute = function(index) {
      if (!tests[index].logic) {
        try {
          throw new Error(tests[index].msg); // collect the callstack
        } catch (e) {
          fail++;
          tests[index].error = e.stack + "\n";
        }
      } else {
        tests[index].pass = true;
        pass++;
      }
    },
    soon    = function(failmsg, logic) {
      tests.push({
        logic: logic,
        msg : failmsg,
      });

      var index = tests.length-1;
      return function(m, l) {
        tests[index].msg = m || failmsg;
        tests[index].logic   = l || logic;
        execute(index);
      };
    },
    ok      = function(failmsg, logic) {
      tests.push({
        logic: logic,
        msg : failmsg,
      });
      execute(tests.length-1);
    };

//
// Tests
//

var sanityConductor = conductor(),
    sanityNode = sanityConductor.node(function(){}, "sanityNode"),
    sanityContext = new Context();

// Sanity
ok("conductor should expose a node method",
   typeof conductor().node === "function");

ok("Nodes should have input and output methods",
   typeof sanityNode.input === "function" &&
   typeof sanityNode.output === "function");

// For debugging
ok("Nodes should have names if provided", sanityNode.name === "sanityNode");
ok("Nodes should have their id as a name if a name is not provided",
   sanityConductor.node().name === 1);

ok("Root level context has no parent", (new Context()).parent === null);

var reparented = new Context();
reparented.reparent(new Context(null, true));
ok("Reparented nodes should still be leafs",
   reparented.parent.splitNode === true);

ok("a node's edges are empty by default",
   sanityNode.edges.input.length() === 0 &&
   sanityNode.edges.output.length() === 0 &&
   sanityNode.edges.callback.length() === 0);

ok("empty edges should be satisfied by default",
   sanityNode.edges.input.satisfied(sanityContext) &&
   sanityNode.edges.output.satisfied(sanityContext) &&
   sanityNode.edges.callback.satisfied(sanityContext));

ok("empty edges are neither fork nor join nodes",
   sanityNode.isFork() === false && sanityNode.isJoin() === false);

var forkNode = sanityConductor.node(null, "forkNode"),
    joinNode = sanityConductor.node(null, "joinNode"),
    forkNode2 = sanityConductor.node(null, "forkNode2");

forkNode.output(joinNode.input(0));
forkNode.input(0, joinNode.input(1));
forkNode2.input(0, joinNode.input(2));
forkNode2.input(1, joinNode.input(3));

ok("nodes with an output and a callback are fork nodes", forkNode.isFork());
ok("nodes with multiple callbacks are fork nodes", forkNode2.isFork());

// Satisfaction (no callbacks)
var satisfyNode = conductor().node(null, "satisfyNode"),
    satisfyHelper = conductor().node(null, "satisfyHelper"),
    satisfyContext = new Context();

ok("empty input edges are satisfied by default",
   satisfyNode.edges.input.satisfied(satisfyContext));

ok("empty output edges are satisfied by default",
   satisfyHelper.edges.output.satisfied(satisfyContext));

satisfyHelper.output(satisfyNode.input(0));

ok("non-empty input edges are not satisfied by default",
   !satisfyNode.edges.input.satisfied(satisfyContext));

satisfyNode.output(0, satisfyHelper.input(1));
ok("non-empty output edges are not satisfied by default",
   !satisfyNode.edges.output.satisfied(satisfyContext));

satisfyHelper.output(satisfyNode.input(1));
satisfyNode.edges.input.satisfy(satisfyContext, 0, "satisfying input 0");
ok("a join node input edge is not satisfied when only one input is satisfied",
   !satisfyNode.edges.input.satisfied(satisfyContext));

satisfyNode.edges.input.satisfy(satisfyContext, 1, "satisfying input 1");
ok("a join node input edge is satisfied when all inputs are satisfied",
   satisfyNode.edges.input.satisfied(satisfyContext));

// Satisfaction (callbacks)
/*
  [scn1]
   |  |
   | [scn2]
   |  |
  [scn3]
*/

var satisfyCallbackConductor = conductor(),
    scn1 = satisfyCallbackConductor.node(null, "scn1"),
    scn2 = satisfyCallbackConductor.node(null, "scn2"),
    scn3 = satisfyCallbackConductor.node(null, "scn3"),
    scc  = new Context();

scn1.execute = scn2.execute = scn3.execute = function() {};

scn1.input(0, scn2.input(0));
scn1.input(1, scn3.input(0));
scn2.output(0, scn3.input(0));

ok("callbacks should not unsatisfy a fork node's inputs",
   scn1.edges.input.satisfied(scc));

ok("fork nodes are not satisfied when no callbacks have been satisfied",
   !scn1.edges.callback.satisfied(scc));

scn1.edges.callback.satisfy(scc, 0, "scn1's output from callback 1");
ok("fork nodes are not satisfied until all callbacks have been satisfied",
   !scn1.edges.callback.satisfied(scc));

scn1.edges.callback.satisfy(scc, 1, "scn1's output from callback 2");
ok("fork nodes emit when all callbacks have been satisfied",
   scn1.edges.callback.satisfied(scc));

console.log(scn2.edges.input.values(scc))

ok("when a fork node is satisfied, its values are forwarded",
   scn2.edges.input.satisfied(scc));



// Ports and pipes
var ptc = conductor(),
    ptc1 = ptc.node(function() { return "hello"; }, "ptc1"),
    ptc2 = ptc.node(function() {  }, "ptc2"),
    ptcContext = new Context(),
    ptcExecute = soon("values should be passed into execute");

ptc1.output(ptc2.input(0));

ptc2.execute = function(context) {
  ptcExecute(null, this.edges.input.values(context)[0] === "testing");
};

ptc1.edges.output.satisfy(ptcContext, 0, "testing");
ok("ptc2's input edge should be satisfied",
   ptc2.edges.input.satisfied(ptcContext));


// Sanity test
var c = conductor(),
    n = c.node(function() {
      return "first node!";
    }, "first node");

var basicSyncTest = soon("basic sync test: expecting 'first node!'", null);
n.output(function(str) {
  basicSyncTest(null, str === "first node!");
});
c.execute();

// 2 node flow (Sync)
var c1 = conductor(),
    n1 = c1.node(function() {
      return "1";
    }, "n1"),
    n2 = c1.node(function(str) {
      return str + "2";
    }, "n2");

var chainedTest = soon("chained sync test: expecting 12");
n2.input(0, n1.output());
n2.output(function(str) {
  chainedTest(null, str === "12");
});

c1.execute();

// Split and join (Sync)
var flow = conductor(),
    saj = {
      A : flow.node(function(a1, a2) { a1("A1"); a2("A2"); }, "saj-A"),
      B : flow.node(function(str) { return "B" + str }, "saj-B"),
      C : flow.node(function(str) { return "C" + str }, "saj-C"),
      D : flow.node(function(str1, str2) { return str1 + str2; }, "saj-D"),
    }, splitAndJoinSyncTest = soon("Execution should result in BA1CA2");
saj.A.input(0, saj.B.input(0));
saj.A.input(1, saj.C.input(0));
saj.B.output(saj.D.input(0));
saj.C.output(saj.D.input(1));
saj.D.output(function(value) {
  console.log("in D", value);
  splitAndJoinSyncTest("Execution should result in BA1CA2 not " + value,
                   value === "BA1CA2");
});

flow.execute();
/*
// Split and join (Async)
var flow = conductor(),
    sajAsync = {
      A : flow.node(function(a1, a2) { a1("A1"); a2("A2"); }),
      B : flow.node(function(str) { return "B" + str }),
      C : flow.node(function(fn, str) {
        setTimeout(function() {
          if (typeof fn === "function") {
            fn("C" + str);
          }
        }, 10);
      }),
      D : flow.node(function(str1, str2) { return str1 + str2; })
    }, splitAndJoinAsyncTest = soon("Execution should result in BA1CA2");

sajAsync.B.input(0, sajAsync.A.input(0)); // callback
sajAsync.C.input(1, sajAsync.A.input(1)); // callback
sajAsync.D.input(0, sajAsync.B.output(0));
sajAsync.D.input(1, sajAsync.C.input(0)); // callback
sajAsync.D.output(0,function(value) {
  splitAndJoinAsyncTest("Execution should result in BA1CA2 not " + value,
     value === "BA1CA2");
});

flow.execute();

// Parallel flows (Async)
var results = [4,3,2,1],
    pflow = conductor(),
    pAsync = {
      A : pflow.node(function(fn) {
        var count = 4, loc = 1;
        setTimeout(function next() {
          if (typeof fn === "function") {
            fn(loc);
          }
          loc++;
          if (loc <= count) {
            setTimeout(next, 0);
          }
        }, 0);
      }),
      B : pflow.node(function(value, fn) {
        setTimeout(function() {
          if (typeof fn === "function") {
            fn(value);
          }
        }, 1000/value);
      }),
      C : pflow.node(function(value) {
        results.push(value);
        return value;
      }),
      D : pflow.node(function(value) {
          var ex = results.shift();
          ok("parallel results should be " + ex + " not " + value, value === ex);
      })
    };

pAsync.B.input(0, pAsync.A.input(0));
pAsync.C.input(0, pAsync.B.input(1));
pAsync.C.output(0, pAsync.D.input(0));
pflow.execute();


// Paralell Asynchronous Split/Join
var paspResults = [10,9,8,7,6,5,4,3,2,1],
    paspflow = conductor(),
    pasp = {
      A : paspflow.node(function(cb1, cb2) {
        console.log("in a");
        var count = 10, loc = 1;
        setTimeout(function paspnext() {
          console.log("calling cb1", loc);
          cb1(loc);
          loc++;
          console.log("calling cb2", loc);
          cb2(loc);
          loc++;
          if (loc <= count) {
            setTimeout(paspnext, 0);
          }
        }, 0);
        console.log("exiting a");
      }),
      B : paspflow.node(function(value, fn) {
        console.log("in b", value);
        setTimeout(function() {
          if (typeof fn === "function") {
            fn(value);
          }
        }, 1000/value);
      }),
      C : paspflow.node(function(value) {
        console.log("in c", value);
        return value;
      }),
      D : paspflow.node(function(v1, v2) {
        console.log("in d:", v1, v2);
        return v1+ "" + v2;
      }),
      E : paspflow.node(function(value) {
          console.log("in e", value);
          var ex = paspResults.shift();
          ok("parallel split/join results should be " + ex + " not " + value,
             value === ex);
      })
    };

pasp.B.input(0, pasp.A.input(0));
pasp.C.input(0, pasp.A.input(1));
pasp.D.input(0, pasp.B.input(1));
pasp.D.input(1, pasp.C.output(0));
pasp.E.input(0, pasp.D.output(0));
paspflow.execute();
*/
//
// RESULTS
//
process.on("exit", function() {
console.log("Exiting!");
  for (var i=0; i<tests.length; i++) {
    if (tests[i].error) {
      console.log(tests[i].error);
    } else if (!tests[i].pass) {
      console.log("Error: ", tests[i].msg, "\n    not executed\n");
    }
  }

  console.log(JSON.stringify({
   total: tests.length,
   fail: tests.length - pass,
   pass: pass
  }));
});
