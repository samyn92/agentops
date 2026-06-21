import {
  createEffect
} from "./chunk-JNFR4PU6.js";

// node_modules/@ark-ui/solid/dist/chunk/ROP6QZQ7.js
var isRefFn = (ref) => typeof ref === "function";
var setRefs = (refs, node) => {
  for (const ref of refs) {
    if (isRefFn(ref)) {
      ref(node);
    }
  }
};
function composeRefs(...refs) {
  let node = null;
  createEffect(() => {
    setRefs(refs, node);
  });
  return (el) => {
    node = el;
    setRefs(refs, el);
  };
}

export {
  composeRefs
};
//# sourceMappingURL=chunk-H6FIBI44.js.map
