import {
  splitRenderStrategyProps
} from "./chunk-3ROPPDLW.js";
import {
  createContext,
  createMachine,
  createProps,
  createSplitProps,
  getComputedStyle,
  getEventTarget,
  getWindow,
  nextTick,
  normalizeProps,
  raf,
  runIfFn,
  setStyle,
  useMachine
} from "./chunk-GXWXGF3R.js";
import {
  createEffect,
  createMemo,
  createSignal
} from "./chunk-JNFR4PU6.js";

// node_modules/@zag-js/presence/dist/presence.connect.mjs
function connect(service, _normalize) {
  const { state, send, context } = service;
  const present = state.matches("mounted", "unmountSuspended");
  return {
    skip: !context.get("initial"),
    present,
    setNode(node) {
      if (!node) return;
      send({ type: "NODE.SET", node });
    },
    unmount() {
      send({ type: "UNMOUNT" });
    }
  };
}

// node_modules/@zag-js/presence/dist/presence.machine.mjs
var machine = createMachine({
  props({ props: props2 }) {
    return { ...props2, present: !!props2.present };
  },
  initialState({ prop }) {
    return prop("present") ? "mounted" : "unmounted";
  },
  refs() {
    return {
      node: null,
      styles: null
    };
  },
  context({ bindable }) {
    return {
      unmountAnimationName: bindable(() => ({ defaultValue: null })),
      prevAnimationName: bindable(() => ({ defaultValue: null })),
      present: bindable(() => ({ defaultValue: false })),
      initial: bindable(() => ({
        sync: true,
        defaultValue: false
      }))
    };
  },
  exit: ["cleanupNode"],
  watch({ track, prop, send }) {
    track([() => prop("present")], () => {
      send({ type: "PRESENCE.CHANGED" });
    });
  },
  on: {
    "NODE.SET": {
      actions: ["setupNode"]
    },
    "PRESENCE.CHANGED": {
      actions: ["setInitial", "syncPresence"]
    }
  },
  states: {
    mounted: {
      on: {
        UNMOUNT: {
          target: "unmounted",
          actions: ["clearPrevAnimationName", "invokeOnExitComplete"]
        },
        "UNMOUNT.SUSPEND": {
          target: "unmountSuspended"
        }
      }
    },
    unmountSuspended: {
      effects: ["trackAnimationEvents"],
      on: {
        MOUNT: {
          target: "mounted",
          actions: ["setPrevAnimationName"]
        },
        UNMOUNT: {
          target: "unmounted",
          actions: ["clearPrevAnimationName", "invokeOnExitComplete"]
        }
      }
    },
    unmounted: {
      on: {
        MOUNT: {
          target: "mounted",
          actions: ["setPrevAnimationName"]
        }
      }
    }
  },
  implementations: {
    actions: {
      setInitial: ({ context }) => {
        if (context.get("initial")) return;
        queueMicrotask(() => {
          context.set("initial", true);
        });
      },
      invokeOnExitComplete: ({ prop, refs }) => {
        prop("onExitComplete")?.();
        const node = refs.get("node");
        if (!node) return;
        const win = getWindow(node);
        const event = new win.CustomEvent("exitcomplete", { bubbles: false });
        node.dispatchEvent(event);
      },
      setupNode: ({ refs, event }) => {
        if (refs.get("node") === event.node) return;
        refs.set("node", event.node);
        refs.set("styles", getComputedStyle(event.node));
      },
      cleanupNode: ({ refs }) => {
        refs.set("node", null);
        refs.set("styles", null);
      },
      syncPresence: ({ context, refs, send, prop }) => {
        const presentProp = prop("present");
        if (presentProp) {
          return send({ type: "MOUNT", src: "presence.changed" });
        }
        const node = refs.get("node");
        if (!presentProp && node?.ownerDocument.visibilityState === "hidden") {
          return send({ type: "UNMOUNT", src: "visibilitychange" });
        }
        raf(() => {
          if (prop("present")) return;
          const animationName = getAnimationName(refs.get("styles"));
          context.set("unmountAnimationName", animationName);
          if (animationName === "none" || animationName === context.get("prevAnimationName") || refs.get("styles")?.display === "none" || refs.get("styles")?.animationDuration === "0s") {
            send({ type: "UNMOUNT", src: "presence.changed" });
          } else {
            send({ type: "UNMOUNT.SUSPEND" });
          }
        });
      },
      setPrevAnimationName: ({ context, refs }) => {
        raf(() => {
          context.set("prevAnimationName", getAnimationName(refs.get("styles")));
        });
      },
      clearPrevAnimationName: ({ context }) => {
        context.set("prevAnimationName", null);
      }
    },
    effects: {
      trackAnimationEvents: ({ context, refs, send, prop }) => {
        const node = refs.get("node");
        if (!node) return;
        const onStart = (event) => {
          const target = event.composedPath?.()?.[0] ?? event.target;
          if (target === node) {
            context.set("prevAnimationName", getAnimationName(refs.get("styles")));
          }
        };
        const onEnd = (event) => {
          const animationName = getAnimationName(refs.get("styles"));
          const target = getEventTarget(event);
          if (target === node && animationName === context.get("unmountAnimationName") && !prop("present")) {
            send({ type: "UNMOUNT", src: "animationend" });
          }
        };
        const onCancel = (event) => {
          const target = getEventTarget(event);
          if (target === node && !prop("present")) {
            send({ type: "UNMOUNT", src: "animationcancel" });
          }
        };
        node.addEventListener("animationstart", onStart);
        node.addEventListener("animationcancel", onCancel);
        node.addEventListener("animationend", onEnd);
        const cleanupStyles = setStyle(node, { animationFillMode: "forwards" });
        return () => {
          node.removeEventListener("animationstart", onStart);
          node.removeEventListener("animationcancel", onCancel);
          node.removeEventListener("animationend", onEnd);
          nextTick(() => cleanupStyles());
        };
      }
    }
  }
});
function getAnimationName(styles) {
  return styles?.animationName || "none";
}

// node_modules/@zag-js/presence/dist/presence.props.mjs
var props = createProps()(["onExitComplete", "present", "immediate"]);

// node_modules/@ark-ui/solid/dist/chunk/X22PRPOR.js
var usePresence = (props2) => {
  const [renderStrategyProps, localProps] = splitRenderStrategyProps(runIfFn(props2));
  const [wasEverPresent, setWasEverPresent] = createSignal(false);
  const service = useMachine(machine, props2);
  const api = createMemo(() => connect(service, normalizeProps));
  createEffect(() => {
    const present = api().present;
    if (present) setWasEverPresent(true);
  });
  const setNode = (node) => {
    if (!node) return;
    service.send({ type: "NODE.SET", node });
  };
  return createMemo(() => ({
    unmounted: !api().present && !wasEverPresent() && renderStrategyProps.lazyMount || renderStrategyProps.unmountOnExit && !api().present && wasEverPresent(),
    present: api().present,
    ref: setNode,
    presenceProps: {
      hidden: !api().present,
      "data-state": api().skip && localProps.skipAnimationOnMount ? void 0 : localProps.present ? "open" : "closed"
    }
  }));
};

// node_modules/@ark-ui/solid/dist/chunk/JBLHW7IM.js
var splitPresenceProps = (props2) => createSplitProps()(props2, [
  "immediate",
  "lazyMount",
  "onExitComplete",
  "present",
  "skipAnimationOnMount",
  "unmountOnExit"
]);
var [PresenceProvider, usePresenceContext] = createContext({
  hookName: "usePresenceContext",
  providerName: "<PresenceProvider />"
});

export {
  usePresence,
  splitPresenceProps,
  PresenceProvider,
  usePresenceContext
};
//# sourceMappingURL=chunk-426QHY4I.js.map
