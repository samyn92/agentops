import {
  getPlacement,
  getPlacementStyles
} from "./chunk-XVBBZP2A.js";
import {
  isFocusVisible,
  trackFocusVisible
} from "./chunk-FFK77TTL.js";
import {
  PresenceProvider,
  splitPresenceProps,
  usePresence,
  usePresenceContext
} from "./chunk-426QHY4I.js";
import "./chunk-3ROPPDLW.js";
import {
  composeRefs
} from "./chunk-H6FIBI44.js";
import {
  __export,
  addDomEvent,
  ark,
  createAnatomy,
  createContext,
  createGuards,
  createMachine,
  createProps,
  createSplitProps,
  createSplitProps2,
  createStore,
  dataAttr,
  ensureProps,
  getOverflowAncestors,
  isComposingEvent,
  isFunction,
  isLeftClick,
  mergeProps as mergeProps2,
  normalizeProps,
  queryAll,
  runIfFn,
  useEnvironmentContext,
  useLocaleContext,
  useMachine
} from "./chunk-GXWXGF3R.js";
import "./chunk-B3FRG6SU.js";
import {
  Show,
  createComponent,
  createMemo,
  createUniqueId,
  mergeProps
} from "./chunk-JNFR4PU6.js";
import "./chunk-5WRI5ZAA.js";

// node_modules/@zag-js/tooltip/dist/tooltip.anatomy.mjs
var anatomy = createAnatomy("tooltip").parts("trigger", "arrow", "arrowTip", "positioner", "content");
var parts = anatomy.build();

// node_modules/@zag-js/tooltip/dist/tooltip.dom.mjs
var getTriggerId = (scope, value) => {
  const customId = scope.ids?.trigger;
  if (customId != null) return isFunction(customId) ? customId(value) : customId;
  return value ? `tooltip:${scope.id}:trigger:${value}` : `tooltip:${scope.id}:trigger`;
};
var getContentId = (scope) => scope.ids?.content ?? `tooltip:${scope.id}:content`;
var getArrowId = (scope) => scope.ids?.arrow ?? `tooltip:${scope.id}:arrow`;
var getPositionerId = (scope) => scope.ids?.positioner ?? `tooltip:${scope.id}:popper`;
var getPositionerEl = (scope) => scope.getById(getPositionerId(scope));
var getTriggerEls = (scope) => queryAll(scope.getDoc(), `[data-scope="tooltip"][data-part="trigger"][data-ownedby="${scope.id}"]`);
var getActiveTriggerEl = (scope, value) => {
  return value == null ? getTriggerEls(scope)[0] : scope.getById(getTriggerId(scope, value));
};

// node_modules/@zag-js/tooltip/dist/tooltip.store.mjs
var store = createStore({
  id: null,
  prevId: null,
  instant: false
});

// node_modules/@zag-js/tooltip/dist/tooltip.connect.mjs
function connect(service, normalize) {
  const { state, context, send, scope, prop, event: _event } = service;
  const id = prop("id");
  const hasAriaLabel = !!prop("aria-label");
  const open = state.matches("open", "closing");
  const triggerValue = context.get("triggerValue");
  const contentId = getContentId(scope);
  const disabled = prop("disabled");
  const popperStyles = getPlacementStyles({
    ...prop("positioning"),
    placement: context.get("currentPlacement")
  });
  return {
    open,
    setOpen(nextOpen) {
      const open2 = state.matches("open", "closing");
      if (open2 === nextOpen) return;
      send({ type: nextOpen ? "open" : "close" });
    },
    triggerValue,
    setTriggerValue(value) {
      send({ type: "triggerValue.set", value: value ?? void 0 });
    },
    reposition(options = {}) {
      send({ type: "positioning.set", options });
    },
    getTriggerProps(props2 = {}) {
      const { value } = props2;
      const current = value == null ? false : triggerValue === value;
      const triggerId = getTriggerId(scope, value);
      return normalize.button({
        ...parts.trigger.attrs,
        id: triggerId,
        "data-ownedby": scope.id,
        "data-value": value,
        "data-current": dataAttr(current),
        dir: prop("dir"),
        "data-expanded": dataAttr(open),
        "data-state": open ? "open" : "closed",
        "aria-describedby": open ? contentId : void 0,
        onClick(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (!prop("closeOnClick")) return;
          const shouldSwitch = open && value != null && !current;
          send({ type: shouldSwitch ? "triggerValue.set" : "close", src: "trigger.click", value, triggerId });
        },
        onFocus(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (!isFocusVisible()) return;
          const shouldSwitch = open && value != null && !current;
          send({ type: shouldSwitch ? "triggerValue.set" : "open", src: "trigger.focus", value, triggerId });
        },
        onBlur(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (id !== store.get("id")) return;
          const activeEl = event.relatedTarget ?? scope.getDoc().activeElement;
          const focusedAnotherTrigger = activeEl?.closest(`[data-ownedby="${scope.id}"]`) != null;
          if (!focusedAnotherTrigger) {
            send({ type: "close", src: "trigger.blur", value, triggerId });
          }
        },
        onPointerDown(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (!isLeftClick(event)) return;
          if (!prop("closeOnPointerDown")) return;
          if (id === store.get("id")) {
            send({ type: "close", src: "trigger.pointerdown", value, triggerId });
          }
        },
        onPointerMove(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (event.pointerType === "touch") return;
          const shouldSwitch = open && value != null && !current;
          send({ type: shouldSwitch ? "triggerValue.set" : "pointer.move", value, triggerId });
        },
        onPointerOver(event) {
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (event.pointerType === "touch") return;
          send({ type: "pointer.move", value, triggerId });
        },
        onPointerLeave() {
          if (disabled) return;
          send({ type: "pointer.leave" });
        },
        onPointerCancel() {
          if (disabled) return;
          send({ type: "pointer.leave" });
        }
      });
    },
    getArrowProps() {
      return normalize.element({
        id: getArrowId(scope),
        ...parts.arrow.attrs,
        dir: prop("dir"),
        style: popperStyles.arrow
      });
    },
    getArrowTipProps() {
      return normalize.element({
        ...parts.arrowTip.attrs,
        dir: prop("dir"),
        style: popperStyles.arrowTip
      });
    },
    getPositionerProps() {
      return normalize.element({
        id: getPositionerId(scope),
        ...parts.positioner.attrs,
        dir: prop("dir"),
        style: popperStyles.floating
      });
    },
    getContentProps() {
      const isCurrentTooltip = store.get("id") === id;
      const isPrevTooltip = store.get("prevId") === id;
      const instant = store.get("instant") && (open && isCurrentTooltip || isPrevTooltip);
      return normalize.element({
        ...parts.content.attrs,
        dir: prop("dir"),
        hidden: !open,
        "data-state": open ? "open" : "closed",
        "data-instant": dataAttr(instant),
        role: hasAriaLabel ? void 0 : "tooltip",
        id: hasAriaLabel ? void 0 : contentId,
        "data-placement": context.get("currentPlacement"),
        onPointerEnter() {
          send({ type: "content.pointer.move" });
        },
        onPointerLeave() {
          send({ type: "content.pointer.leave" });
        },
        style: {
          pointerEvents: prop("interactive") ? "auto" : "none"
        }
      });
    }
  };
}

// node_modules/@zag-js/tooltip/dist/tooltip.machine.mjs
var { and, not } = createGuards();
var machine = createMachine({
  initialState: ({ prop }) => {
    const open = prop("open") || prop("defaultOpen");
    return open ? "open" : "closed";
  },
  props({ props: props2 }) {
    ensureProps(props2, ["id"]);
    const closeOnClick = props2.closeOnClick ?? true;
    const closeOnPointerDown = props2.closeOnPointerDown ?? closeOnClick;
    return {
      openDelay: 400,
      closeDelay: 150,
      closeOnEscape: true,
      interactive: false,
      closeOnScroll: true,
      disabled: false,
      ...props2,
      closeOnPointerDown,
      closeOnClick,
      positioning: {
        placement: "bottom",
        ...props2.positioning
      }
    };
  },
  effects: ["trackFocusVisible", "trackStore"],
  context: ({ bindable, prop, scope }) => ({
    currentPlacement: bindable(() => ({ defaultValue: void 0 })),
    hasPointerMoveOpened: bindable(() => ({ defaultValue: null })),
    triggerValue: bindable(() => ({
      defaultValue: prop("defaultTriggerValue") ?? null,
      value: prop("triggerValue"),
      onChange(value) {
        const onTriggerValueChange = prop("onTriggerValueChange");
        if (!onTriggerValueChange) return;
        const triggerElement = getActiveTriggerEl(scope, value);
        onTriggerValueChange({ value, triggerElement });
      }
    }))
  }),
  watch({ track, action, prop }) {
    track([() => prop("disabled")], () => {
      action(["closeIfDisabled"]);
    });
    track([() => prop("open")], () => {
      action(["toggleVisibility"]);
    });
    track([() => prop("triggerValue")], () => {
      action(["repositionImmediate"]);
    });
  },
  on: {
    "triggerValue.set": {
      actions: ["setTriggerValue", "repositionImmediate"]
    }
  },
  states: {
    closed: {
      entry: ["clearGlobalId"],
      on: {
        "controlled.open": {
          target: "open"
        },
        open: [
          {
            guard: "isOpenControlled",
            actions: ["setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setTriggerValue", "invokeOnOpen"]
          }
        ],
        "pointer.leave": {
          actions: ["clearPointerMoveOpened"]
        },
        "pointer.move": [
          {
            guard: and("noVisibleTooltip", not("hasPointerMoveOpened")),
            target: "opening",
            actions: ["setTriggerValue"]
          },
          {
            guard: not("hasPointerMoveOpened"),
            target: "open",
            actions: ["setPointerMoveOpened", "invokeOnOpen", "setTriggerValue"]
          }
        ]
      }
    },
    opening: {
      effects: ["trackScroll", "trackPointerlockChange", "waitForOpenDelay"],
      on: {
        "after.openDelay": [
          {
            guard: "isOpenControlled",
            actions: ["setPointerMoveOpened", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setPointerMoveOpened", "invokeOnOpen"]
          }
        ],
        "controlled.open": {
          target: "open"
        },
        "controlled.close": {
          target: "closed"
        },
        open: [
          {
            guard: "isOpenControlled",
            actions: ["setTriggerValue", "invokeOnOpen"]
          },
          {
            target: "open",
            actions: ["setTriggerValue", "invokeOnOpen"]
          }
        ],
        "pointer.leave": [
          {
            guard: "isOpenControlled",
            // We trigger toggleVisibility manually since the `ctx.open` has not changed yet (at this point)
            actions: ["clearPointerMoveOpened", "invokeOnClose", "toggleVisibility"]
          },
          {
            target: "closed",
            actions: ["clearPointerMoveOpened", "invokeOnClose"]
          }
        ],
        close: [
          {
            guard: "isOpenControlled",
            // We trigger toggleVisibility manually since the `ctx.open` has not changed yet (at this point)
            actions: ["invokeOnClose", "toggleVisibility"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose"]
          }
        ]
      }
    },
    open: {
      effects: ["trackEscapeKey", "trackScroll", "trackPointerlockChange", "trackPositioning"],
      entry: ["setGlobalId"],
      on: {
        "controlled.close": {
          target: "closed"
        },
        close: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose"]
          }
        ],
        "pointer.leave": [
          {
            guard: "isVisible",
            target: "closing",
            actions: ["clearPointerMoveOpened"]
          },
          // == group ==
          {
            guard: "isOpenControlled",
            actions: ["clearPointerMoveOpened", "invokeOnClose"]
          },
          {
            target: "closed",
            actions: ["clearPointerMoveOpened", "invokeOnClose"]
          }
        ],
        "content.pointer.leave": {
          guard: "isInteractive",
          target: "closing"
        },
        "positioning.set": {
          actions: ["reposition"]
        },
        "triggerValue.set": {
          // Transition to closing (which cleans up trackPositioning) then immediately back to open
          // This re-creates the positioning effect with the new trigger
          target: "closing",
          actions: ["setTriggerValue", "immediateReopen"]
        }
      }
    },
    closing: {
      effects: ["trackPositioning", "waitForCloseDelay"],
      on: {
        "after.closeDelay": [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose"]
          }
        ],
        "controlled.close": {
          target: "closed"
        },
        "controlled.open": {
          target: "open"
        },
        close: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose"]
          }
        ],
        "pointer.move": [
          {
            guard: "isOpenControlled",
            // We trigger toggleVisibility manually since the `ctx.open` has not changed yet (at this point)
            actions: ["setPointerMoveOpened", "setTriggerValue", "invokeOnOpen", "toggleVisibility"]
          },
          {
            target: "open",
            actions: ["setPointerMoveOpened", "setTriggerValue", "invokeOnOpen"]
          }
        ],
        "triggerValue.set": {
          target: "open",
          actions: ["setTriggerValue", "repositionImmediate"]
        },
        reopen: {
          target: "open"
        },
        "content.pointer.move": {
          guard: "isInteractive",
          target: "open"
        },
        "positioning.set": {
          actions: ["reposition"]
        }
      }
    }
  },
  implementations: {
    guards: {
      noVisibleTooltip: () => store.get("id") === null,
      isVisible: ({ prop }) => prop("id") === store.get("id"),
      isInteractive: ({ prop }) => !!prop("interactive"),
      hasPointerMoveOpened: ({ context }) => !!context.get("hasPointerMoveOpened"),
      isOpenControlled: ({ prop }) => prop("open") !== void 0
    },
    actions: {
      setGlobalId: ({ prop }) => {
        const prevId = store.get("id");
        const isInstant = prevId !== null && prevId !== prop("id");
        store.update({ id: prop("id"), prevId: isInstant ? prevId : null, instant: isInstant });
      },
      clearGlobalId: ({ prop }) => {
        if (prop("id") === store.get("id")) {
          store.update({ id: null, prevId: null, instant: false });
        }
      },
      invokeOnOpen: ({ prop }) => {
        prop("onOpenChange")?.({ open: true });
      },
      invokeOnClose: ({ prop }) => {
        prop("onOpenChange")?.({ open: false });
      },
      closeIfDisabled: ({ prop, send }) => {
        if (!prop("disabled")) return;
        send({ type: "close", src: "disabled.change" });
      },
      reposition: ({ context, event, prop, scope }) => {
        if (event.type !== "positioning.set") return;
        const getPositionerEl2 = () => getPositionerEl(scope);
        const getTriggerEl = () => getActiveTriggerEl(scope, context.get("triggerValue"));
        getPlacement(getTriggerEl, getPositionerEl2, {
          ...prop("positioning"),
          ...event.options,
          listeners: false,
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      repositionImmediate: ({ context, event, prop, scope }) => {
        const triggerValue = event.value ?? context.get("triggerValue");
        const getPositionerEl2 = () => getPositionerEl(scope);
        const getTriggerEl = () => getActiveTriggerEl(scope, triggerValue);
        return getPlacement(getTriggerEl, getPositionerEl2, {
          ...prop("positioning"),
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      toggleVisibility: ({ prop, event, send }) => {
        queueMicrotask(() => {
          send({
            type: prop("open") ? "controlled.open" : "controlled.close",
            previousEvent: event
          });
        });
      },
      setPointerMoveOpened: ({ context, event }) => {
        const triggerId = event.triggerId ?? event.previousEvent?.triggerId;
        context.set("hasPointerMoveOpened", triggerId ?? null);
      },
      clearPointerMoveOpened: ({ context }) => {
        context.set("hasPointerMoveOpened", null);
      },
      setTriggerValue: ({ context, event }) => {
        if (event.value === void 0) return;
        context.set("triggerValue", event.value);
      },
      immediateReopen: ({ send }) => {
        queueMicrotask(() => {
          send({ type: "reopen" });
        });
      }
    },
    effects: {
      trackFocusVisible: ({ scope }) => {
        return trackFocusVisible({ root: scope.getRootNode?.() });
      },
      trackPositioning: ({ context, prop, scope }) => {
        if (!context.get("currentPlacement")) {
          context.set("currentPlacement", prop("positioning").placement);
        }
        const getPositionerEl2 = () => getPositionerEl(scope);
        const getTriggerEl = () => getActiveTriggerEl(scope, context.get("triggerValue"));
        return getPlacement(getTriggerEl, getPositionerEl2, {
          ...prop("positioning"),
          defer: true,
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      trackPointerlockChange: ({ send, scope }) => {
        const doc = scope.getDoc();
        const onChange = () => send({ type: "close", src: "pointerlock:change" });
        return addDomEvent(doc, "pointerlockchange", onChange, false);
      },
      trackScroll: ({ send, prop, scope, context }) => {
        if (!prop("closeOnScroll")) return;
        const triggerValue = context.get("triggerValue");
        const triggerEl = getActiveTriggerEl(scope, triggerValue);
        if (!triggerEl) return;
        const overflowParents = getOverflowAncestors(triggerEl);
        const cleanups = overflowParents.map((overflowParent) => {
          const onScroll = () => {
            send({ type: "close", src: "scroll" });
          };
          return addDomEvent(overflowParent, "scroll", onScroll, {
            passive: true,
            capture: true
          });
        });
        return () => {
          cleanups.forEach((fn) => fn?.());
        };
      },
      trackStore: ({ prop, send }) => {
        let cleanup;
        queueMicrotask(() => {
          cleanup = store.subscribe(() => {
            if (store.get("id") !== prop("id")) {
              send({ type: "close", src: "id.change" });
            }
          });
        });
        return () => cleanup?.();
      },
      trackEscapeKey: ({ send, prop }) => {
        if (!prop("closeOnEscape")) return;
        const onKeyDown = (event) => {
          if (isComposingEvent(event)) return;
          if (event.key !== "Escape") return;
          event.stopPropagation();
          send({ type: "close", src: "keydown.escape" });
        };
        return addDomEvent(document, "keydown", onKeyDown, true);
      },
      waitForOpenDelay: ({ send, prop, event }) => {
        const id = setTimeout(() => {
          send({ type: "after.openDelay", previousEvent: event });
        }, prop("openDelay"));
        return () => clearTimeout(id);
      },
      waitForCloseDelay: ({ send, prop, event }) => {
        const id = setTimeout(() => {
          send({ type: "after.closeDelay", previousEvent: event });
        }, prop("closeDelay"));
        return () => clearTimeout(id);
      }
    }
  }
});

// node_modules/@zag-js/tooltip/dist/tooltip.props.mjs
var props = createProps()([
  "aria-label",
  "closeDelay",
  "closeOnClick",
  "closeOnEscape",
  "closeOnPointerDown",
  "closeOnScroll",
  "defaultOpen",
  "defaultTriggerValue",
  "dir",
  "disabled",
  "getRootNode",
  "id",
  "ids",
  "interactive",
  "onOpenChange",
  "onTriggerValueChange",
  "open",
  "openDelay",
  "positioning",
  "triggerValue"
]);
var splitProps = createSplitProps2(props);

// node_modules/@ark-ui/solid/dist/chunk/HYWCNTXA.js
var [TooltipProvider, useTooltipContext] = createContext({
  hookName: "useTooltipContext",
  providerName: "<TooltipProvider />"
});
var TooltipArrow = (props2) => {
  const tooltip2 = useTooltipContext();
  const mergedProps = mergeProps2(() => tooltip2().getArrowProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var TooltipArrowTip = (props2) => {
  const api = useTooltipContext();
  const mergedProps = mergeProps2(() => api().getArrowTipProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var TooltipContent = (props2) => {
  const api = useTooltipContext();
  const presenceApi = usePresenceContext();
  const mergedProps = mergeProps2(() => api().getContentProps(), () => presenceApi().presenceProps, props2);
  return createComponent(Show, {
    get when() {
      return !presenceApi().unmounted;
    },
    get children() {
      return createComponent(ark.div, mergeProps(mergedProps, {
        ref(r$) {
          var _ref$ = composeRefs(presenceApi().ref, props2.ref);
          typeof _ref$ === "function" && _ref$(r$);
        }
      }));
    }
  });
};
var TooltipContext = (props2) => props2.children(useTooltipContext());
var TooltipPositioner = (props2) => {
  const api = useTooltipContext();
  const presenceApi = usePresenceContext();
  const mergedProps = mergeProps2(() => api().getPositionerProps(), props2);
  return createComponent(Show, {
    get when() {
      return !presenceApi().unmounted;
    },
    get children() {
      return createComponent(ark.div, mergedProps);
    }
  });
};
var useTooltip = (props2) => {
  const id = createUniqueId();
  const locale = useLocaleContext();
  const environment = useEnvironmentContext();
  const machineProps = createMemo(() => ({
    id,
    dir: locale().dir,
    getRootNode: environment().getRootNode,
    ...runIfFn(props2)
  }));
  const service = useMachine(machine, machineProps);
  return createMemo(() => connect(service, normalizeProps));
};
var TooltipRoot = (props2) => {
  const [presenceProps, tooltipProps] = splitPresenceProps(props2);
  const [useTooltipProps, localProps] = createSplitProps()(tooltipProps, ["aria-label", "closeDelay", "closeOnClick", "closeOnEscape", "closeOnPointerDown", "closeOnScroll", "defaultOpen", "disabled", "id", "ids", "interactive", "onOpenChange", "open", "openDelay", "positioning", "triggerValue", "defaultTriggerValue", "onTriggerValueChange"]);
  const api = useTooltip(useTooltipProps);
  const apiPresence = usePresence(mergeProps2(presenceProps, () => ({
    present: api().open
  })));
  return createComponent(TooltipProvider, {
    value: api,
    get children() {
      return createComponent(PresenceProvider, {
        value: apiPresence,
        get children() {
          return localProps.children;
        }
      });
    }
  });
};
var TooltipRootProvider = (props2) => {
  const [presenceProps, tooltipProps] = splitPresenceProps(props2);
  const presence = usePresence(mergeProps2(presenceProps, () => ({
    present: tooltipProps.value().open
  })));
  return createComponent(TooltipProvider, {
    get value() {
      return tooltipProps.value;
    },
    get children() {
      return createComponent(PresenceProvider, {
        value: presence,
        get children() {
          return tooltipProps.children;
        }
      });
    }
  });
};
var TooltipTrigger = (props2) => {
  const [triggerProps, localProps] = createSplitProps()(props2, ["value"]);
  const api = useTooltipContext();
  const mergedProps = mergeProps2(() => api().getTriggerProps(triggerProps), localProps);
  return createComponent(ark.button, mergedProps);
};
var tooltip_exports = {};
__export(tooltip_exports, {
  Arrow: () => TooltipArrow,
  ArrowTip: () => TooltipArrowTip,
  Content: () => TooltipContent,
  Context: () => TooltipContext,
  Positioner: () => TooltipPositioner,
  Root: () => TooltipRoot,
  RootProvider: () => TooltipRootProvider,
  Trigger: () => TooltipTrigger
});
export {
  tooltip_exports as Tooltip,
  TooltipArrow,
  TooltipArrowTip,
  TooltipContent,
  TooltipContext,
  TooltipPositioner,
  TooltipRoot,
  TooltipRootProvider,
  TooltipTrigger,
  anatomy as tooltipAnatomy,
  useTooltip,
  useTooltipContext
};
//# sourceMappingURL=@ark-ui_solid_tooltip.js.map
