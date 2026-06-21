import {
  splitRenderStrategyProps
} from "./chunk-3ROPPDLW.js";
import {
  __export,
  ark,
  createAnatomy,
  createContext,
  createMachine,
  createProps,
  createSplitProps,
  createSplitProps2,
  dataAttr,
  getComputedStyle,
  getEventTarget,
  getTabbables,
  mergeProps,
  nextTick,
  normalizeProps,
  observeChildren,
  raf,
  runIfFn,
  setAttribute,
  setStyle,
  toPx,
  useEnvironmentContext,
  useLocaleContext,
  useMachine
} from "./chunk-GXWXGF3R.js";
import "./chunk-B3FRG6SU.js";
import {
  Show,
  createComponent,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId
} from "./chunk-JNFR4PU6.js";
import "./chunk-5WRI5ZAA.js";

// node_modules/@zag-js/collapsible/dist/collapsible.anatomy.mjs
var anatomy = createAnatomy("collapsible").parts("root", "trigger", "content", "indicator");
var parts = anatomy.build();

// node_modules/@zag-js/collapsible/dist/collapsible.dom.mjs
var getRootId = (ctx) => ctx.ids?.root ?? `collapsible:${ctx.id}`;
var getContentId = (ctx) => ctx.ids?.content ?? `collapsible:${ctx.id}:content`;
var getTriggerId = (ctx) => ctx.ids?.trigger ?? `collapsible:${ctx.id}:trigger`;
var getContentEl = (ctx) => ctx.getById(getContentId(ctx));

// node_modules/@zag-js/collapsible/dist/collapsible.connect.mjs
function connect(service, normalize) {
  const { state, send, context, scope, prop } = service;
  const visible = state.matches("open") || state.matches("closing");
  const open = state.matches("open");
  const closed = state.matches("closed");
  const { width, height } = context.get("size");
  const disabled = !!prop("disabled");
  const collapsedHeight = prop("collapsedHeight");
  const collapsedWidth = prop("collapsedWidth");
  const hasCollapsedHeight = collapsedHeight != null;
  const hasCollapsedWidth = collapsedWidth != null;
  const hasCollapsedSize = hasCollapsedHeight || hasCollapsedWidth;
  const skip = !context.get("initial") && open;
  return {
    disabled,
    visible,
    open,
    measureSize() {
      send({ type: "size.measure" });
    },
    setOpen(nextOpen) {
      const open2 = state.matches("open");
      if (open2 === nextOpen) return;
      send({ type: nextOpen ? "open" : "close" });
    },
    getRootProps() {
      return normalize.element({
        ...parts.root.attrs,
        "data-state": open ? "open" : "closed",
        dir: prop("dir"),
        id: getRootId(scope)
      });
    },
    getContentProps() {
      return normalize.element({
        ...parts.content.attrs,
        id: getContentId(scope),
        "data-collapsible": "",
        "data-state": skip ? void 0 : open ? "open" : "closed",
        "data-disabled": dataAttr(disabled),
        "data-has-collapsed-size": dataAttr(hasCollapsedSize),
        hidden: !visible && !hasCollapsedSize,
        dir: prop("dir"),
        style: {
          "--height": toPx(height),
          "--width": toPx(width),
          "--collapsed-height": toPx(collapsedHeight),
          "--collapsed-width": toPx(collapsedWidth),
          ...closed && hasCollapsedHeight && {
            overflow: "hidden",
            minHeight: toPx(collapsedHeight),
            maxHeight: toPx(collapsedHeight)
          },
          ...closed && hasCollapsedWidth && {
            overflow: "hidden",
            minWidth: toPx(collapsedWidth),
            maxWidth: toPx(collapsedWidth)
          }
        }
      });
    },
    getTriggerProps() {
      return normalize.element({
        ...parts.trigger.attrs,
        id: getTriggerId(scope),
        dir: prop("dir"),
        type: "button",
        "data-state": open ? "open" : "closed",
        "data-disabled": dataAttr(disabled),
        "aria-controls": getContentId(scope),
        "aria-expanded": visible || false,
        onClick(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          send({ type: open ? "close" : "open" });
        }
      });
    },
    getIndicatorProps() {
      return normalize.element({
        ...parts.indicator.attrs,
        dir: prop("dir"),
        "data-state": open ? "open" : "closed",
        "data-disabled": dataAttr(disabled)
      });
    }
  };
}

// node_modules/@zag-js/collapsible/dist/collapsible.machine.mjs
var machine = createMachine({
  initialState({ prop }) {
    const open = prop("open") || prop("defaultOpen");
    return open ? "open" : "closed";
  },
  context({ bindable }) {
    return {
      size: bindable(() => ({
        defaultValue: { height: 0, width: 0 },
        sync: true
      })),
      initial: bindable(() => ({
        defaultValue: false
      }))
    };
  },
  refs() {
    return {
      cleanup: void 0,
      stylesRef: void 0
    };
  },
  watch({ track, prop, action }) {
    track([() => prop("open")], () => {
      action(["setInitial", "computeSize", "toggleVisibility"]);
    });
  },
  exit: ["cleanupNode"],
  states: {
    closed: {
      effects: ["trackTabbableElements"],
      on: {
        "controlled.open": {
          target: "open"
        },
        open: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setInitial", "computeSize", "invokeOnOpen"]
          }
        ]
      }
    },
    closing: {
      effects: ["trackExitAnimation"],
      on: {
        "controlled.close": {
          target: "closed"
        },
        "controlled.open": {
          target: "open"
        },
        open: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setInitial", "invokeOnOpen"]
          }
        ],
        close: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnExitComplete"]
          },
          {
            target: "closed",
            actions: ["setInitial", "computeSize", "invokeOnExitComplete"]
          }
        ],
        "animation.end": {
          target: "closed",
          actions: ["invokeOnExitComplete", "clearInitial"]
        }
      }
    },
    open: {
      effects: ["trackEnterAnimation"],
      on: {
        "controlled.close": {
          target: "closing"
        },
        close: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose"]
          },
          {
            target: "closing",
            actions: ["setInitial", "computeSize", "invokeOnClose"]
          }
        ],
        "size.measure": {
          actions: ["measureSize"]
        },
        "animation.end": {
          actions: ["clearInitial"]
        }
      }
    }
  },
  implementations: {
    guards: {
      isOpenControlled: ({ prop }) => prop("open") != void 0
    },
    effects: {
      trackEnterAnimation: ({ send, scope }) => {
        let cleanup;
        const rafCleanup = raf(() => {
          const contentEl = getContentEl(scope);
          if (!contentEl) return;
          const animationName = getComputedStyle(contentEl).animationName;
          const hasNoAnimation = !animationName || animationName === "none";
          if (hasNoAnimation) {
            send({ type: "animation.end" });
            return;
          }
          const onEnd = (event) => {
            const target = getEventTarget(event);
            if (target === contentEl) {
              send({ type: "animation.end" });
            }
          };
          contentEl.addEventListener("animationend", onEnd);
          cleanup = () => {
            contentEl.removeEventListener("animationend", onEnd);
          };
        });
        return () => {
          rafCleanup();
          cleanup?.();
        };
      },
      trackExitAnimation: ({ send, scope }) => {
        let cleanup;
        const rafCleanup = raf(() => {
          const contentEl = getContentEl(scope);
          if (!contentEl) return;
          const animationName = getComputedStyle(contentEl).animationName;
          const hasNoAnimation = !animationName || animationName === "none";
          if (hasNoAnimation) {
            send({ type: "animation.end" });
            return;
          }
          const onEnd = (event) => {
            const target = getEventTarget(event);
            if (target === contentEl) {
              send({ type: "animation.end" });
            }
          };
          contentEl.addEventListener("animationend", onEnd);
          const restoreStyles = setStyle(contentEl, {
            animationFillMode: "forwards"
          });
          cleanup = () => {
            contentEl.removeEventListener("animationend", onEnd);
            nextTick(() => restoreStyles());
          };
        });
        return () => {
          rafCleanup();
          cleanup?.();
        };
      },
      trackTabbableElements: ({ scope, prop }) => {
        if (!prop("collapsedHeight") && !prop("collapsedWidth")) return;
        const contentEl = getContentEl(scope);
        if (!contentEl) return;
        const applyInertToTabbables = () => {
          const tabbables = getTabbables(contentEl);
          const restoreAttrs = tabbables.map((tabbable) => setAttribute(tabbable, "inert", ""));
          return () => {
            restoreAttrs.forEach((attr) => attr());
          };
        };
        let restoreInert = applyInertToTabbables();
        const observerCleanup = observeChildren(contentEl, {
          callback() {
            restoreInert();
            restoreInert = applyInertToTabbables();
          }
        });
        return () => {
          restoreInert();
          observerCleanup();
        };
      }
    },
    actions: {
      setInitial: ({ context, flush }) => {
        flush(() => {
          context.set("initial", true);
        });
      },
      clearInitial: ({ context }) => {
        context.set("initial", false);
      },
      cleanupNode: ({ refs }) => {
        refs.set("stylesRef", null);
      },
      measureSize: ({ context, scope }) => {
        const contentEl = getContentEl(scope);
        if (!contentEl) return;
        const { height, width } = contentEl.getBoundingClientRect();
        context.set("size", { height, width });
      },
      computeSize: ({ refs, scope, context }) => {
        refs.get("cleanup")?.();
        const rafCleanup = raf(() => {
          const contentEl = getContentEl(scope);
          if (!contentEl) return;
          const hidden = contentEl.hidden;
          contentEl.style.animationName = "none";
          contentEl.style.animationDuration = "0s";
          contentEl.hidden = false;
          const rect = contentEl.getBoundingClientRect();
          context.set("size", { height: rect.height, width: rect.width });
          if (context.get("initial")) {
            contentEl.style.animationName = "";
            contentEl.style.animationDuration = "";
          }
          contentEl.hidden = hidden;
        });
        refs.set("cleanup", rafCleanup);
      },
      invokeOnOpen: ({ prop }) => {
        prop("onOpenChange")?.({ open: true });
      },
      invokeOnClose: ({ prop }) => {
        prop("onOpenChange")?.({ open: false });
      },
      invokeOnExitComplete: ({ prop }) => {
        prop("onExitComplete")?.();
      },
      toggleVisibility: ({ prop, send }) => {
        send({ type: prop("open") ? "controlled.open" : "controlled.close" });
      }
    }
  }
});

// node_modules/@zag-js/collapsible/dist/collapsible.props.mjs
var props = createProps()([
  "dir",
  "disabled",
  "getRootNode",
  "id",
  "ids",
  "collapsedHeight",
  "collapsedWidth",
  "onExitComplete",
  "onOpenChange",
  "defaultOpen",
  "open"
]);
var splitProps = createSplitProps2(props);

// node_modules/@ark-ui/solid/dist/chunk/HBI6JRIQ.js
var [CollapsibleProvider, useCollapsibleContext] = createContext({
  hookName: "useCollapsibleContext",
  providerName: "<CollapsibleProvider />"
});
var CollapsibleContent = (props2) => {
  const api = useCollapsibleContext();
  const mergedProps = mergeProps(() => api().getContentProps(), props2);
  return createComponent(Show, {
    get when() {
      return !api().unmounted;
    },
    get children() {
      return createComponent(ark.div, mergedProps);
    }
  });
};
var CollapsibleContext = (props2) => props2.children(useCollapsibleContext());
var useCollapsible = (props2 = {}) => {
  const id = createUniqueId();
  const locale = useLocaleContext();
  const environment = useEnvironmentContext();
  const [renderStrategyProps, collapsibleProps] = splitRenderStrategyProps(runIfFn(props2));
  const machineProps = createMemo(() => ({
    id,
    dir: locale().dir,
    getRootNode: environment().getRootNode,
    ...collapsibleProps
  }));
  const service = useMachine(machine, machineProps);
  const [wasVisible, setWasVisible] = createSignal(false);
  createEffect(() => {
    const isPresent = api().visible;
    if (isPresent) setWasVisible(true);
  });
  const api = createMemo(() => connect(service, normalizeProps));
  return createMemo(() => ({
    ...api(),
    unmounted: !api().visible && !wasVisible() && renderStrategyProps.lazyMount || renderStrategyProps.unmountOnExit && !api().visible && wasVisible()
  }));
};
var CollapsibleRoot = (props2) => {
  const [useCollapsibleProps, localProps] = createSplitProps()(props2, ["collapsedHeight", "collapsedWidth", "defaultOpen", "disabled", "id", "ids", "lazyMount", "onExitComplete", "onOpenChange", "open", "unmountOnExit"]);
  const api = useCollapsible(useCollapsibleProps);
  const mergedProps = mergeProps(() => api().getRootProps(), localProps);
  return createComponent(CollapsibleProvider, {
    value: api,
    get children() {
      return createComponent(ark.div, mergedProps);
    }
  });
};
var CollapsibleRootProvider = (props2) => {
  const [{
    value: collapsible2
  }, localProps] = createSplitProps()(props2, ["value"]);
  const mergedProps = mergeProps(() => collapsible2().getRootProps(), localProps);
  return createComponent(CollapsibleProvider, {
    value: collapsible2,
    get children() {
      return createComponent(ark.div, mergedProps);
    }
  });
};
var CollapsibleTrigger = (props2) => {
  const api = useCollapsibleContext();
  const mergedProps = mergeProps(() => api().getTriggerProps(), props2);
  return createComponent(ark.button, mergedProps);
};
var CollapsibleIndicator = (props2) => {
  const collapsible2 = useCollapsibleContext();
  const mergedProps = mergeProps(() => collapsible2().getIndicatorProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var collapsible_exports = {};
__export(collapsible_exports, {
  Content: () => CollapsibleContent,
  Context: () => CollapsibleContext,
  Indicator: () => CollapsibleIndicator,
  Root: () => CollapsibleRoot,
  RootProvider: () => CollapsibleRootProvider,
  Trigger: () => CollapsibleTrigger
});
export {
  collapsible_exports as Collapsible,
  CollapsibleContent,
  CollapsibleContext,
  CollapsibleIndicator,
  CollapsibleRoot,
  CollapsibleRootProvider,
  CollapsibleTrigger,
  anatomy as collapsibleAnatomy,
  useCollapsible,
  useCollapsibleContext
};
//# sourceMappingURL=@ark-ui_solid_collapsible.js.map
