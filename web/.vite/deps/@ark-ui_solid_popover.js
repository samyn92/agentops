import {
  getPlacement,
  getPlacementStyles
} from "./chunk-XVBBZP2A.js";
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
  ariaAttr,
  ark,
  callAll,
  contains,
  createAnatomy,
  createContext,
  createMachine,
  createProps,
  createSplitProps,
  createSplitProps2,
  dataAttr,
  findControlledElements,
  getActiveElement,
  getComputedStyle,
  getControlledElements,
  getDocument,
  getEventTarget,
  getFocusables,
  getInitialFocus,
  getNearestOverflowAncestor,
  getTabIndex,
  getTabbables,
  getWindow,
  hasControllerElements,
  isContextMenuEvent,
  isControlledByExpandedController,
  isControlledElement,
  isDocument,
  isFocusable,
  isFunction,
  isHTMLElement,
  isIos,
  isLeftClick,
  isSafari,
  isShadowRoot,
  isTabbable,
  isTouchDevice,
  mergeProps as mergeProps2,
  nextTick,
  normalizeProps,
  proxyTabFocus,
  queryAll,
  raf,
  runIfFn,
  setStyle,
  setStyleProperty,
  useEnvironmentContext,
  useLocaleContext,
  useMachine,
  waitForElement,
  warn
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

// node_modules/@zag-js/popover/dist/popover.anatomy.mjs
var anatomy = createAnatomy("popover").parts(
  "arrow",
  "arrowTip",
  "anchor",
  "trigger",
  "indicator",
  "positioner",
  "content",
  "title",
  "description",
  "closeTrigger"
);
var parts = anatomy.build();

// node_modules/@zag-js/popover/dist/popover.dom.mjs
var getAnchorId = (scope) => scope.ids?.anchor ?? `popover:${scope.id}:anchor`;
var getTriggerId = (scope, value) => {
  const customId = scope.ids?.trigger;
  if (customId != null) return isFunction(customId) ? customId(value) : customId;
  return value ? `popover:${scope.id}:trigger:${value}` : `popover:${scope.id}:trigger`;
};
var getContentId = (scope) => scope.ids?.content ?? `popover:${scope.id}:content`;
var getPositionerId = (scope) => scope.ids?.positioner ?? `popover:${scope.id}:popper`;
var getArrowId = (scope) => scope.ids?.arrow ?? `popover:${scope.id}:arrow`;
var getTitleId = (scope) => scope.ids?.title ?? `popover:${scope.id}:title`;
var getDescriptionId = (scope) => scope.ids?.description ?? `popover:${scope.id}:desc`;
var getCloseTriggerId = (scope) => scope.ids?.closeTrigger ?? `popover:${scope.id}:close`;
var getAnchorEl = (scope) => scope.getById(getAnchorId(scope));
var getTriggerEls = (scope) => queryAll(scope.getDoc(), `[data-scope="popover"][data-part="trigger"][data-ownedby="${scope.id}"]`);
var getActiveTriggerEl = (scope, value) => {
  return value == null ? getTriggerEls(scope)[0] : scope.getById(getTriggerId(scope, value));
};
var getContentEl = (scope) => scope.getById(getContentId(scope));
var getPositionerEl = (scope) => scope.getById(getPositionerId(scope));
var getTitleEl = (scope) => scope.getById(getTitleId(scope));
var getDescriptionEl = (scope) => scope.getById(getDescriptionId(scope));

// node_modules/@zag-js/popover/dist/popover.connect.mjs
function connect(service, normalize) {
  const { state, context, send, computed, prop, scope } = service;
  const translations = prop("translations");
  const open = state.matches("open");
  const currentPlacement = context.get("currentPlacement");
  const portalled = computed("currentPortalled");
  const rendered = context.get("renderedElements");
  const triggerValue = context.get("triggerValue");
  const popperStyles = getPlacementStyles({
    ...prop("positioning"),
    placement: currentPlacement
  });
  return {
    portalled,
    open,
    setOpen(nextOpen) {
      const open2 = state.matches("open");
      if (open2 === nextOpen) return;
      send({ type: nextOpen ? "OPEN" : "CLOSE" });
    },
    triggerValue,
    setTriggerValue(value) {
      send({ type: "TRIGGER_VALUE.SET", value });
    },
    reposition(options = {}) {
      send({ type: "POSITIONING.SET", options });
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
    getAnchorProps() {
      return normalize.element({
        ...parts.anchor.attrs,
        dir: prop("dir"),
        id: getAnchorId(scope)
      });
    },
    getTriggerProps(props2 = {}) {
      const { value } = props2;
      const current = value == null ? false : triggerValue === value;
      return normalize.button({
        ...parts.trigger.attrs,
        dir: prop("dir"),
        type: "button",
        "data-placement": currentPlacement,
        id: getTriggerId(scope, value),
        "data-ownedby": scope.id,
        "data-value": value,
        "data-current": dataAttr(current),
        "aria-haspopup": "dialog",
        "aria-expanded": value == null ? open : open && current,
        "data-state": open ? "open" : "closed",
        "aria-controls": getContentId(scope),
        onPointerDown(event) {
          if (!isLeftClick(event)) return;
          if (isSafari()) {
            event.currentTarget.focus();
          }
        },
        onClick(event) {
          if (event.defaultPrevented) return;
          const shouldSwitch = open && value != null && !current;
          send({ type: shouldSwitch ? "TRIGGER_VALUE.SET" : "TOGGLE", value });
        },
        onBlur(event) {
          send({ type: "TRIGGER_BLUR", target: event.relatedTarget });
        }
      });
    },
    getIndicatorProps() {
      return normalize.element({
        ...parts.indicator.attrs,
        dir: prop("dir"),
        "data-state": open ? "open" : "closed"
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
      return normalize.element({
        ...parts.content.attrs,
        dir: prop("dir"),
        id: getContentId(scope),
        tabIndex: -1,
        role: "dialog",
        "aria-modal": ariaAttr(prop("modal")),
        hidden: !open,
        "data-state": open ? "open" : "closed",
        "data-expanded": dataAttr(open),
        "aria-labelledby": rendered.title ? getTitleId(scope) : void 0,
        "aria-describedby": rendered.description ? getDescriptionId(scope) : void 0,
        "data-placement": currentPlacement
      });
    },
    getTitleProps() {
      return normalize.element({
        ...parts.title.attrs,
        id: getTitleId(scope),
        dir: prop("dir")
      });
    },
    getDescriptionProps() {
      return normalize.element({
        ...parts.description.attrs,
        id: getDescriptionId(scope),
        dir: prop("dir")
      });
    },
    getCloseTriggerProps() {
      return normalize.button({
        ...parts.closeTrigger.attrs,
        dir: prop("dir"),
        id: getCloseTriggerId(scope),
        type: "button",
        "aria-label": translations.closeTriggerLabel,
        onClick(event) {
          if (event.defaultPrevented) return;
          event.stopPropagation();
          send({ type: "CLOSE" });
        }
      });
    }
  };
}

// node_modules/@zag-js/aria-hidden/dist/walk-tree-outside.mjs
var counterMap = /* @__PURE__ */ new WeakMap();
var uncontrolledNodes = /* @__PURE__ */ new WeakMap();
var markerMap = {};
var lockCount = 0;
var unwrapHost = (node) => node && (node.host || unwrapHost(node.parentNode));
var correctTargets = (parent, targets) => targets.map((target) => {
  if (parent.contains(target)) return target;
  const correctedTarget = unwrapHost(target);
  if (correctedTarget && parent.contains(correctedTarget)) {
    return correctedTarget;
  }
  console.error("[zag-js > ariaHidden] target", target, "in not contained inside", parent, ". Doing nothing");
  return null;
}).filter((x) => Boolean(x));
var ignoreableNodes = /* @__PURE__ */ new Set(["script", "output", "status", "next-route-announcer"]);
var isIgnoredNode = (node) => {
  if (ignoreableNodes.has(node.localName)) return true;
  if (node.role === "status") return true;
  if (node.hasAttribute("aria-live")) return true;
  return node.matches("[data-live-announcer]");
};
var walkTreeOutside = (originalTarget, props2) => {
  const { parentNode, markerName, controlAttribute, explicitBooleanValue, followControlledElements = true } = props2;
  const targets = correctTargets(parentNode, Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
  markerMap[markerName] || (markerMap[markerName] = /* @__PURE__ */ new WeakMap());
  const markerCounter = markerMap[markerName];
  const hiddenNodes = [];
  const elementsToKeep = /* @__PURE__ */ new Set();
  const elementsToStop = new Set(targets);
  const keep = (el) => {
    if (!el || elementsToKeep.has(el)) return;
    elementsToKeep.add(el);
    keep(el.parentNode);
  };
  targets.forEach((target) => {
    keep(target);
    if (followControlledElements && isHTMLElement(target)) {
      findControlledElements(target, (controlledElement) => {
        keep(controlledElement);
      });
    }
  });
  const deep = (parent) => {
    if (!parent || elementsToStop.has(parent)) {
      return;
    }
    Array.prototype.forEach.call(parent.children, (node) => {
      if (elementsToKeep.has(node)) {
        deep(node);
      } else {
        try {
          if (isIgnoredNode(node)) return;
          const attr = node.getAttribute(controlAttribute);
          const alreadyHidden = explicitBooleanValue ? attr === "true" : attr !== null && attr !== "false";
          const counterValue = (counterMap.get(node) || 0) + 1;
          const markerValue = (markerCounter.get(node) || 0) + 1;
          counterMap.set(node, counterValue);
          markerCounter.set(node, markerValue);
          hiddenNodes.push(node);
          if (counterValue === 1 && alreadyHidden) {
            uncontrolledNodes.set(node, true);
          }
          if (markerValue === 1) {
            node.setAttribute(markerName, "");
          }
          if (!alreadyHidden) {
            node.setAttribute(controlAttribute, explicitBooleanValue ? "true" : "");
          }
        } catch (e) {
          console.error("[zag-js > ariaHidden] cannot operate on ", node, e);
        }
      }
    });
  };
  deep(parentNode);
  elementsToKeep.clear();
  lockCount++;
  return () => {
    hiddenNodes.forEach((node) => {
      const counterValue = counterMap.get(node) - 1;
      const markerValue = markerCounter.get(node) - 1;
      counterMap.set(node, counterValue);
      markerCounter.set(node, markerValue);
      if (!counterValue) {
        if (!uncontrolledNodes.has(node)) {
          node.removeAttribute(controlAttribute);
        }
        uncontrolledNodes.delete(node);
      }
      if (!markerValue) {
        node.removeAttribute(markerName);
      }
    });
    lockCount--;
    if (!lockCount) {
      counterMap = /* @__PURE__ */ new WeakMap();
      counterMap = /* @__PURE__ */ new WeakMap();
      uncontrolledNodes = /* @__PURE__ */ new WeakMap();
      markerMap = {};
    }
  };
};

// node_modules/@zag-js/aria-hidden/dist/aria-hidden.mjs
var getParentNode = (originalTarget) => {
  const target = Array.isArray(originalTarget) ? originalTarget[0] : originalTarget;
  return target.ownerDocument.body;
};
var hideOthers = (originalTarget, parentNode = getParentNode(originalTarget), markerName = "data-aria-hidden", followControlledElements = true) => {
  if (!parentNode) return;
  return walkTreeOutside(originalTarget, {
    parentNode,
    markerName,
    controlAttribute: "aria-hidden",
    explicitBooleanValue: true,
    followControlledElements
  });
};

// node_modules/@zag-js/aria-hidden/dist/index.mjs
var raf2 = (fn) => {
  const frameId = requestAnimationFrame(() => fn());
  return () => cancelAnimationFrame(frameId);
};
function ariaHidden(targetsOrFn, options = {}) {
  const { defer = true } = options;
  const func = defer ? raf2 : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      const targets = typeof targetsOrFn === "function" ? targetsOrFn() : targetsOrFn;
      const elements = targets.filter(Boolean);
      if (elements.length === 0) return;
      cleanups.push(hideOthers(elements));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}

// node_modules/@zag-js/interact-outside/dist/frame-utils.mjs
function getWindowFrames(win) {
  const frames = {
    each(cb) {
      for (let i = 0; i < win.frames?.length; i += 1) {
        const frame = win.frames[i];
        if (frame) cb(frame);
      }
    },
    addEventListener(event, listener, options) {
      frames.each((frame) => {
        try {
          frame.document.addEventListener(event, listener, options);
        } catch {
        }
      });
      return () => {
        try {
          frames.removeEventListener(event, listener, options);
        } catch {
        }
      };
    },
    removeEventListener(event, listener, options) {
      frames.each((frame) => {
        try {
          frame.document.removeEventListener(event, listener, options);
        } catch {
        }
      });
    }
  };
  return frames;
}
function getParentWindow(win) {
  const parent = win.frameElement != null ? win.parent : null;
  return {
    addEventListener: (event, listener, options) => {
      try {
        parent?.addEventListener(event, listener, options);
      } catch {
      }
      return () => {
        try {
          parent?.removeEventListener(event, listener, options);
        } catch {
        }
      };
    },
    removeEventListener: (event, listener, options) => {
      try {
        parent?.removeEventListener(event, listener, options);
      } catch {
      }
    }
  };
}

// node_modules/@zag-js/interact-outside/dist/index.mjs
var POINTER_OUTSIDE_EVENT = "pointerdown.outside";
var FOCUS_OUTSIDE_EVENT = "focus.outside";
function isComposedPathFocusable(composedPath) {
  for (const node of composedPath) {
    if (isHTMLElement(node) && isFocusable(node)) return true;
  }
  return false;
}
var isPointerEvent = (event) => "clientY" in event;
function isEventPointWithin(node, event) {
  if (!isPointerEvent(event) || !node) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
}
function isPointInRect(rect, point) {
  return rect.y <= point.y && point.y <= rect.y + rect.height && rect.x <= point.x && point.x <= rect.x + rect.width;
}
function isEventWithinScrollbar(event, ancestor) {
  if (!ancestor || !isPointerEvent(event)) return false;
  const isScrollableY = ancestor.scrollHeight > ancestor.clientHeight;
  const onScrollbarY = isScrollableY && event.clientX > ancestor.offsetLeft + ancestor.clientWidth;
  const isScrollableX = ancestor.scrollWidth > ancestor.clientWidth;
  const onScrollbarX = isScrollableX && event.clientY > ancestor.offsetTop + ancestor.clientHeight;
  const rect = {
    x: ancestor.offsetLeft,
    y: ancestor.offsetTop,
    width: ancestor.clientWidth + (isScrollableY ? 16 : 0),
    height: ancestor.clientHeight + (isScrollableX ? 16 : 0)
  };
  const point = {
    x: event.clientX,
    y: event.clientY
  };
  if (!isPointInRect(rect, point)) return false;
  return onScrollbarY || onScrollbarX;
}
function trackInteractOutsideImpl(node, options) {
  const {
    exclude,
    onFocusOutside,
    onPointerDownOutside,
    onInteractOutside,
    defer,
    followControlledElements = true
  } = options;
  if (!node) return;
  const doc = getDocument(node);
  const win = getWindow(node);
  const frames = getWindowFrames(win);
  const parentWin = getParentWindow(win);
  function isEventOutside(event, target) {
    if (!isHTMLElement(target)) return false;
    if (!target.isConnected) return false;
    if (contains(node, target)) return false;
    if (isEventPointWithin(node, event)) return false;
    if (followControlledElements && isControlledElement(node, target)) return false;
    const triggerEl = doc.querySelector(`[aria-controls="${node.id}"]`);
    if (triggerEl) {
      const triggerAncestor = getNearestOverflowAncestor(triggerEl);
      if (isEventWithinScrollbar(event, triggerAncestor)) return false;
    }
    const nodeAncestor = getNearestOverflowAncestor(node);
    if (isEventWithinScrollbar(event, nodeAncestor)) return false;
    return !exclude?.(target);
  }
  const pointerdownCleanups = /* @__PURE__ */ new Set();
  const isInShadowRoot = isShadowRoot(node?.getRootNode());
  let isPointerDown = false;
  function onPointerDown(event) {
    isPointerDown = true;
    const onPointerUp = () => {
      isPointerDown = false;
    };
    doc.addEventListener("pointerup", onPointerUp, { once: true });
    win.addEventListener("pointerup", onPointerUp, { once: true });
    function handler(clickEvent) {
      const func = defer && !isTouchDevice() ? raf : (v) => v();
      const evt = clickEvent ?? event;
      const composedPath = evt?.composedPath?.() ?? [evt?.target];
      func(() => {
        const target = isInShadowRoot ? composedPath[0] : getEventTarget(event);
        if (!node || !isEventOutside(event, target)) return;
        if (onPointerDownOutside || onInteractOutside) {
          const handler2 = callAll(onPointerDownOutside, onInteractOutside);
          node.addEventListener(POINTER_OUTSIDE_EVENT, handler2, { once: true });
        }
        fireCustomEvent(node, POINTER_OUTSIDE_EVENT, {
          bubbles: false,
          cancelable: true,
          detail: {
            originalEvent: evt,
            contextmenu: isContextMenuEvent(evt),
            focusable: isComposedPathFocusable(composedPath),
            target
          }
        });
      });
    }
    if (event.pointerType === "touch") {
      pointerdownCleanups.forEach((fn) => fn());
      pointerdownCleanups.add(addDomEvent(doc, "click", handler, { once: true }));
      pointerdownCleanups.add(parentWin.addEventListener("click", handler, { once: true }));
      pointerdownCleanups.add(frames.addEventListener("click", handler, { once: true }));
    } else {
      handler();
    }
  }
  const cleanups = /* @__PURE__ */ new Set();
  const timer = setTimeout(() => {
    cleanups.add(addDomEvent(doc, "pointerdown", onPointerDown, true));
    cleanups.add(parentWin.addEventListener("pointerdown", onPointerDown, true));
    cleanups.add(frames.addEventListener("pointerdown", onPointerDown, true));
  }, 0);
  function onFocusin(event) {
    if (isPointerDown) return;
    const func = defer ? raf : (v) => v();
    func(() => {
      const composedPath = event?.composedPath?.() ?? [event?.target];
      const target = isInShadowRoot ? composedPath[0] : getEventTarget(event);
      if (!node || !isEventOutside(event, target)) return;
      if (onFocusOutside || onInteractOutside) {
        const handler = callAll(onFocusOutside, onInteractOutside);
        node.addEventListener(FOCUS_OUTSIDE_EVENT, handler, { once: true });
      }
      fireCustomEvent(node, FOCUS_OUTSIDE_EVENT, {
        bubbles: false,
        cancelable: true,
        detail: {
          originalEvent: event,
          contextmenu: false,
          focusable: isFocusable(target),
          target
        }
      });
    });
  }
  if (!isTouchDevice()) {
    cleanups.add(addDomEvent(doc, "focusin", onFocusin, true));
    cleanups.add(parentWin.addEventListener("focusin", onFocusin, true));
    cleanups.add(frames.addEventListener("focusin", onFocusin, true));
  }
  return () => {
    clearTimeout(timer);
    pointerdownCleanups.forEach((fn) => fn());
    cleanups.forEach((fn) => fn());
  };
}
function trackInteractOutside(nodeOrFn, options) {
  const { defer } = options;
  const func = defer ? raf : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      const node = typeof nodeOrFn === "function" ? nodeOrFn() : nodeOrFn;
      cleanups.push(trackInteractOutsideImpl(node, options));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}
function fireCustomEvent(el, type, init) {
  const win = el.ownerDocument.defaultView || window;
  const event = new win.CustomEvent(type, init);
  return el.dispatchEvent(event);
}

// node_modules/@zag-js/dismissable/dist/escape-keydown.mjs
function trackEscapeKeydown(node, fn) {
  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (event.isComposing) return;
    fn?.(event);
  };
  return addDomEvent(getDocument(node), "keydown", handleKeyDown, { capture: true });
}

// node_modules/@zag-js/dismissable/dist/layer-stack.mjs
var LAYER_REQUEST_DISMISS_EVENT = "layer:request-dismiss";
var layerStack = {
  layers: [],
  branches: [],
  recentlyRemoved: /* @__PURE__ */ new Set(),
  count() {
    return this.layers.length;
  },
  pointerBlockingLayers() {
    return this.layers.filter((layer) => layer.pointerBlocking);
  },
  topMostPointerBlockingLayer() {
    return [...this.pointerBlockingLayers()].slice(-1)[0];
  },
  hasPointerBlockingLayer() {
    return this.pointerBlockingLayers().length > 0;
  },
  isBelowPointerBlockingLayer(node) {
    const index = this.indexOf(node);
    const highestBlockingIndex = this.topMostPointerBlockingLayer() ? this.indexOf(this.topMostPointerBlockingLayer()?.node) : -1;
    return index < highestBlockingIndex;
  },
  isTopMost(node) {
    const layer = this.layers[this.count() - 1];
    return layer?.node === node;
  },
  getNestedLayers(node) {
    return Array.from(this.layers).slice(this.indexOf(node) + 1);
  },
  getLayersByType(type) {
    return this.layers.filter((layer) => layer.type === type);
  },
  getNestedLayersByType(node, type) {
    const index = this.indexOf(node);
    if (index === -1) return [];
    return this.layers.slice(index + 1).filter((layer) => layer.type === type);
  },
  getParentLayerOfType(node, type) {
    const index = this.indexOf(node);
    if (index <= 0) return void 0;
    return this.layers.slice(0, index).reverse().find((layer) => layer.type === type);
  },
  countNestedLayersOfType(node, type) {
    return this.getNestedLayersByType(node, type).length;
  },
  isInNestedLayer(node, target) {
    const inNested = this.getNestedLayers(node).some((layer) => contains(layer.node, target));
    if (inNested) return true;
    if (this.recentlyRemoved.size > 0) return true;
    return false;
  },
  isInBranch(target) {
    return Array.from(this.branches).some((branch) => contains(branch, target));
  },
  add(layer) {
    this.layers.push(layer);
    this.syncLayers();
  },
  addBranch(node) {
    this.branches.push(node);
  },
  remove(node) {
    const index = this.indexOf(node);
    if (index < 0) return;
    this.recentlyRemoved.add(node);
    nextTick(() => this.recentlyRemoved.delete(node));
    if (index < this.count() - 1) {
      const _layers = this.getNestedLayers(node);
      _layers.forEach((layer) => layerStack.dismiss(layer.node, node));
    }
    this.layers.splice(index, 1);
    this.syncLayers();
  },
  removeBranch(node) {
    const index = this.branches.indexOf(node);
    if (index >= 0) this.branches.splice(index, 1);
  },
  syncLayers() {
    this.layers.forEach((layer, index) => {
      layer.node.style.setProperty("--layer-index", `${index}`);
      layer.node.removeAttribute("data-nested");
      layer.node.removeAttribute("data-has-nested");
      const parentOfSameType = this.getParentLayerOfType(layer.node, layer.type);
      if (parentOfSameType) {
        layer.node.setAttribute("data-nested", layer.type);
      }
      const nestedCount = this.countNestedLayersOfType(layer.node, layer.type);
      if (nestedCount > 0) {
        layer.node.setAttribute("data-has-nested", layer.type);
      }
      layer.node.style.setProperty("--nested-layer-count", `${nestedCount}`);
    });
  },
  indexOf(node) {
    return this.layers.findIndex((layer) => layer.node === node);
  },
  dismiss(node, parent) {
    const index = this.indexOf(node);
    if (index === -1) return;
    const layer = this.layers[index];
    addListenerOnce(node, LAYER_REQUEST_DISMISS_EVENT, (event) => {
      layer.requestDismiss?.(event);
      if (!event.defaultPrevented) {
        layer?.dismiss();
      }
    });
    fireCustomEvent2(node, LAYER_REQUEST_DISMISS_EVENT, {
      originalLayer: node,
      targetLayer: parent,
      originalIndex: index,
      targetIndex: parent ? this.indexOf(parent) : -1
    });
    this.syncLayers();
  },
  clear() {
    this.remove(this.layers[0].node);
  }
};
function fireCustomEvent2(el, type, detail) {
  const win = el.ownerDocument.defaultView || window;
  const event = new win.CustomEvent(type, { cancelable: true, bubbles: true, detail });
  return el.dispatchEvent(event);
}
function addListenerOnce(el, type, callback) {
  el.addEventListener(type, callback, { once: true });
}

// node_modules/@zag-js/dismissable/dist/pointer-event-outside.mjs
var originalBodyPointerEvents;
function assignPointerEventToLayers() {
  layerStack.layers.forEach(({ node }) => {
    node.style.pointerEvents = layerStack.isBelowPointerBlockingLayer(node) ? "none" : "auto";
  });
}
function clearPointerEvent(node) {
  node.style.pointerEvents = "";
}
function disablePointerEventsOutside(node, persistentElements) {
  const doc = getDocument(node);
  const cleanups = [];
  if (layerStack.hasPointerBlockingLayer() && !doc.body.hasAttribute("data-inert")) {
    originalBodyPointerEvents = document.body.style.pointerEvents;
    queueMicrotask(() => {
      doc.body.style.pointerEvents = "none";
      doc.body.setAttribute("data-inert", "");
    });
  }
  persistentElements?.forEach((el) => {
    const [promise, abort] = waitForElement(
      () => {
        const node2 = el();
        return isHTMLElement(node2) ? node2 : null;
      },
      { timeout: 1e3 }
    );
    promise.then((el2) => cleanups.push(setStyle(el2, { pointerEvents: "auto" })));
    cleanups.push(abort);
  });
  return () => {
    if (layerStack.hasPointerBlockingLayer()) return;
    queueMicrotask(() => {
      doc.body.style.pointerEvents = originalBodyPointerEvents;
      doc.body.removeAttribute("data-inert");
      if (doc.body.style.length === 0) doc.body.removeAttribute("style");
    });
    cleanups.forEach((fn) => fn());
  };
}

// node_modules/@zag-js/dismissable/dist/dismissable-layer.mjs
function trackDismissableElementImpl(node, options) {
  const { warnOnMissingNode = true } = options;
  if (warnOnMissingNode && !node) {
    warn("[@zag-js/dismissable] node is `null` or `undefined`");
    return;
  }
  if (!node) {
    return;
  }
  const { onDismiss, onRequestDismiss, pointerBlocking, exclude: excludeContainers, debug, type = "dialog" } = options;
  const layer = { dismiss: onDismiss, node, type, pointerBlocking, requestDismiss: onRequestDismiss };
  layerStack.add(layer);
  assignPointerEventToLayers();
  function onPointerDownOutside(event) {
    const target = getEventTarget(event.detail.originalEvent);
    if (layerStack.isBelowPointerBlockingLayer(node) || layerStack.isInBranch(target)) return;
    options.onPointerDownOutside?.(event);
    options.onInteractOutside?.(event);
    if (event.defaultPrevented) return;
    if (debug) {
      console.log("onPointerDownOutside:", event.detail.originalEvent);
    }
    onDismiss?.();
  }
  function onFocusOutside(event) {
    const target = getEventTarget(event.detail.originalEvent);
    if (layerStack.isInBranch(target)) return;
    options.onFocusOutside?.(event);
    options.onInteractOutside?.(event);
    if (event.defaultPrevented) return;
    if (debug) {
      console.log("onFocusOutside:", event.detail.originalEvent);
    }
    onDismiss?.();
  }
  function onEscapeKeyDown(event) {
    if (!layerStack.isTopMost(node)) return;
    options.onEscapeKeyDown?.(event);
    if (!event.defaultPrevented && onDismiss) {
      event.preventDefault();
      onDismiss();
    }
  }
  function exclude(target) {
    if (!node) return false;
    const containers = typeof excludeContainers === "function" ? excludeContainers() : excludeContainers;
    const _containers = Array.isArray(containers) ? containers : [containers];
    const persistentElements = options.persistentElements?.map((fn) => fn()).filter(isHTMLElement);
    if (persistentElements) _containers.push(...persistentElements);
    return _containers.some((node2) => contains(node2, target)) || layerStack.isInNestedLayer(node, target);
  }
  const cleanups = [
    pointerBlocking ? disablePointerEventsOutside(node, options.persistentElements) : void 0,
    trackEscapeKeydown(node, onEscapeKeyDown),
    trackInteractOutside(node, { exclude, onFocusOutside, onPointerDownOutside, defer: options.defer })
  ];
  return () => {
    layerStack.remove(node);
    assignPointerEventToLayers();
    clearPointerEvent(node);
    cleanups.forEach((fn) => fn?.());
  };
}
function trackDismissableElement(nodeOrFn, options) {
  const { defer } = options;
  const func = defer ? raf : (v) => v();
  const cleanups = [];
  cleanups.push(
    func(() => {
      const node = isFunction(nodeOrFn) ? nodeOrFn() : nodeOrFn;
      cleanups.push(trackDismissableElementImpl(node, options));
    })
  );
  return () => {
    cleanups.forEach((fn) => fn?.());
  };
}

// node_modules/@zag-js/focus-trap/dist/chunk-QZ7TP4HQ.mjs
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// node_modules/@zag-js/focus-trap/dist/focus-trap.mjs
var activeFocusTraps = {
  activateTrap(trapStack, trap) {
    if (trapStack.length > 0) {
      const activeTrap = trapStack[trapStack.length - 1];
      if (activeTrap !== trap) {
        activeTrap.pause();
      }
    }
    const trapIndex = trapStack.indexOf(trap);
    if (trapIndex === -1) {
      trapStack.push(trap);
    } else {
      trapStack.splice(trapIndex, 1);
      trapStack.push(trap);
    }
  },
  deactivateTrap(trapStack, trap) {
    const trapIndex = trapStack.indexOf(trap);
    if (trapIndex !== -1) {
      trapStack.splice(trapIndex, 1);
    }
    if (trapStack.length > 0) {
      trapStack[trapStack.length - 1].unpause();
    }
  }
};
var sharedTrapStack = [];
var FocusTrap = class {
  constructor(elements, options) {
    __publicField(this, "trapStack");
    __publicField(this, "config");
    __publicField(this, "doc");
    __publicField(this, "state", {
      containers: [],
      containerGroups: [],
      tabbableGroups: [],
      nodeFocusedBeforeActivation: null,
      mostRecentlyFocusedNode: null,
      active: false,
      paused: false,
      delayInitialFocusTimer: void 0,
      recentNavEvent: void 0
    });
    __publicField(this, "portalContainers", /* @__PURE__ */ new Set());
    __publicField(this, "listenerCleanups", []);
    __publicField(this, "handleFocus", (event) => {
      const target = getEventTarget(event);
      const targetContained = this.findContainerIndex(target, event) >= 0;
      if (targetContained || isDocument(target)) {
        if (targetContained) {
          this.state.mostRecentlyFocusedNode = target;
        }
      } else {
        event.stopImmediatePropagation();
        let nextNode;
        let navAcrossContainers = true;
        if (this.state.mostRecentlyFocusedNode) {
          if (getTabIndex(this.state.mostRecentlyFocusedNode) > 0) {
            const mruContainerIdx = this.findContainerIndex(this.state.mostRecentlyFocusedNode);
            const { tabbableNodes } = this.state.containerGroups[mruContainerIdx];
            if (tabbableNodes.length > 0) {
              const mruTabIdx = tabbableNodes.findIndex((node) => node === this.state.mostRecentlyFocusedNode);
              if (mruTabIdx >= 0) {
                if (this.config.isKeyForward(this.state.recentNavEvent)) {
                  if (mruTabIdx + 1 < tabbableNodes.length) {
                    nextNode = tabbableNodes[mruTabIdx + 1];
                    navAcrossContainers = false;
                  }
                } else {
                  if (mruTabIdx - 1 >= 0) {
                    nextNode = tabbableNodes[mruTabIdx - 1];
                    navAcrossContainers = false;
                  }
                }
              }
            }
          } else {
            if (!this.state.containerGroups.some((g) => g.tabbableNodes.some((n) => getTabIndex(n) > 0))) {
              navAcrossContainers = false;
            }
          }
        } else {
          navAcrossContainers = false;
        }
        if (navAcrossContainers) {
          nextNode = this.findNextNavNode({
            // move FROM the MRU node, not event-related node (which will be the node that is
            //  outside the trap causing the focus escape we're trying to fix)
            target: this.state.mostRecentlyFocusedNode,
            isBackward: this.config.isKeyBackward(this.state.recentNavEvent)
          });
        }
        if (nextNode) {
          this.tryFocus(nextNode);
        } else {
          this.tryFocus(this.state.mostRecentlyFocusedNode || this.getInitialFocusNode());
        }
      }
      this.state.recentNavEvent = void 0;
    });
    __publicField(this, "handlePointerDown", (event) => {
      const target = getEventTarget(event);
      if (this.findContainerIndex(target, event) >= 0) {
        return;
      }
      if (valueOrHandler(this.config.clickOutsideDeactivates, event)) {
        this.deactivate({ returnFocus: this.config.returnFocusOnDeactivate });
        return;
      }
      if (valueOrHandler(this.config.allowOutsideClick, event)) {
        return;
      }
      event.preventDefault();
    });
    __publicField(this, "handleClick", (event) => {
      const target = getEventTarget(event);
      if (this.findContainerIndex(target, event) >= 0) {
        return;
      }
      if (valueOrHandler(this.config.clickOutsideDeactivates, event)) {
        return;
      }
      if (valueOrHandler(this.config.allowOutsideClick, event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    __publicField(this, "handleTabKey", (event) => {
      if (this.config.isKeyForward(event) || this.config.isKeyBackward(event)) {
        this.state.recentNavEvent = event;
        const isBackward = this.config.isKeyBackward(event);
        const destinationNode = this.findNextNavNode({ event, isBackward });
        if (!destinationNode) return;
        if (isTabEvent(event)) {
          event.preventDefault();
        }
        this.tryFocus(destinationNode);
      }
    });
    __publicField(this, "handleEscapeKey", (event) => {
      if (isEscapeEvent(event) && valueOrHandler(this.config.escapeDeactivates, event) !== false) {
        event.preventDefault();
        this.deactivate();
      }
    });
    __publicField(this, "_mutationObserver");
    __publicField(this, "setupMutationObserver", () => {
      const win = this.doc.defaultView || window;
      this._mutationObserver = new win.MutationObserver((mutations) => {
        const isFocusedNodeRemoved = mutations.some((mutation) => {
          const removedNodes = Array.from(mutation.removedNodes);
          return removedNodes.some((node) => node === this.state.mostRecentlyFocusedNode);
        });
        if (isFocusedNodeRemoved) {
          this.tryFocus(this.getInitialFocusNode());
        }
        const hasControlledChanges = mutations.some((mutation) => {
          if (mutation.type === "attributes" && (mutation.attributeName === "aria-controls" || mutation.attributeName === "aria-expanded")) {
            return true;
          }
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            return Array.from(mutation.addedNodes).some((node) => {
              if (node.nodeType !== Node.ELEMENT_NODE) return false;
              const element = node;
              if (hasControllerElements(element)) {
                return true;
              }
              if (element.id && !this.state.containers.some((c) => c.contains(element))) {
                return isControlledByExpandedController(element);
              }
              return false;
            });
          }
          return false;
        });
        if (hasControlledChanges && this.state.active && !this.state.paused) {
          this.updateTabbableNodes();
          this.updatePortalContainers();
        }
      });
    });
    __publicField(this, "updateObservedNodes", () => {
      this._mutationObserver?.disconnect();
      if (this.state.active && !this.state.paused) {
        this.state.containers.map((container) => {
          this._mutationObserver?.observe(container, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["aria-controls", "aria-expanded"]
          });
        });
        this.portalContainers.forEach((portalContainer) => {
          this.observePortalContainer(portalContainer);
        });
      }
    });
    __publicField(this, "getInitialFocusNode", () => {
      let node = this.getNodeForOption("initialFocus", { hasFallback: true });
      if (node === false) {
        return false;
      }
      if (node === void 0 || node && !isFocusable(node)) {
        const activeElement = getActiveElement(this.doc);
        if (activeElement && this.findContainerIndex(activeElement) >= 0) {
          node = activeElement;
        } else {
          const firstTabbableGroup = this.state.tabbableGroups[0];
          const firstTabbableNode = firstTabbableGroup && firstTabbableGroup.firstTabbableNode;
          node = firstTabbableNode || this.getNodeForOption("fallbackFocus");
        }
      } else if (node === null) {
        node = this.getNodeForOption("fallbackFocus");
      }
      if (!node) {
        throw new Error("Your focus-trap needs to have at least one focusable element");
      }
      if (!node.isConnected) {
        node = this.getNodeForOption("fallbackFocus");
      }
      if (!node || !node.isConnected) {
        throw new Error("Your focus-trap needs to have at least one focusable element");
      }
      return node;
    });
    __publicField(this, "tryFocus", (node) => {
      if (node === false) return;
      if (node === getActiveElement(this.doc)) return;
      if (!node || !node.focus) {
        this.tryFocus(this.getInitialFocusNode());
        return;
      }
      node.focus({ preventScroll: !!this.config.preventScroll });
      this.state.mostRecentlyFocusedNode = node;
      if (isSelectableInput(node)) {
        node.select();
      }
    });
    __publicField(this, "deactivate", (deactivateOptions) => {
      if (!this.state.active) return this;
      const options2 = {
        onDeactivate: this.config.onDeactivate,
        onPostDeactivate: this.config.onPostDeactivate,
        checkCanReturnFocus: this.config.checkCanReturnFocus,
        ...deactivateOptions
      };
      clearTimeout(this.state.delayInitialFocusTimer);
      this.state.delayInitialFocusTimer = void 0;
      this.removeListeners();
      this.state.active = false;
      this.state.paused = false;
      this.updateObservedNodes();
      activeFocusTraps.deactivateTrap(this.trapStack, this);
      this.portalContainers.clear();
      const onDeactivate = this.getOption(options2, "onDeactivate");
      const onPostDeactivate = this.getOption(options2, "onPostDeactivate");
      const checkCanReturnFocus = this.getOption(options2, "checkCanReturnFocus");
      const returnFocus = this.getOption(options2, "returnFocus", "returnFocusOnDeactivate");
      onDeactivate?.();
      const finishDeactivation = () => {
        delay(() => {
          if (returnFocus) {
            const returnFocusNode = this.getReturnFocusNode(this.state.nodeFocusedBeforeActivation);
            this.tryFocus(returnFocusNode);
          }
          onPostDeactivate?.();
        });
      };
      if (returnFocus && checkCanReturnFocus) {
        const returnFocusNode = this.getReturnFocusNode(this.state.nodeFocusedBeforeActivation);
        checkCanReturnFocus(returnFocusNode).then(finishDeactivation, finishDeactivation);
        return this;
      }
      finishDeactivation();
      return this;
    });
    __publicField(this, "pause", (pauseOptions) => {
      if (this.state.paused || !this.state.active) {
        return this;
      }
      const onPause = this.getOption(pauseOptions, "onPause");
      const onPostPause = this.getOption(pauseOptions, "onPostPause");
      this.state.paused = true;
      onPause?.();
      this.removeListeners();
      this.updateObservedNodes();
      onPostPause?.();
      return this;
    });
    __publicField(this, "unpause", (unpauseOptions) => {
      if (!this.state.paused || !this.state.active) {
        return this;
      }
      const onUnpause = this.getOption(unpauseOptions, "onUnpause");
      const onPostUnpause = this.getOption(unpauseOptions, "onPostUnpause");
      this.state.paused = false;
      onUnpause?.();
      this.updateTabbableNodes();
      this.addListeners();
      this.updateObservedNodes();
      onPostUnpause?.();
      return this;
    });
    __publicField(this, "updateContainerElements", (containerElements) => {
      this.state.containers = Array.isArray(containerElements) ? containerElements.filter(Boolean) : [containerElements].filter(Boolean);
      if (this.state.active) {
        this.updateTabbableNodes();
      }
      this.updateObservedNodes();
      return this;
    });
    __publicField(this, "getReturnFocusNode", (previousActiveElement) => {
      const node = this.getNodeForOption("setReturnFocus", {
        params: [previousActiveElement]
      });
      return node ? node : node === false ? false : previousActiveElement;
    });
    __publicField(this, "getOption", (configOverrideOptions, optionName, configOptionName) => {
      return configOverrideOptions && configOverrideOptions[optionName] !== void 0 ? configOverrideOptions[optionName] : (
        // @ts-expect-error
        this.config[configOptionName || optionName]
      );
    });
    __publicField(this, "getNodeForOption", (optionName, { hasFallback = false, params = [] } = {}) => {
      let optionValue = this.config[optionName];
      if (typeof optionValue === "function") optionValue = optionValue(...params);
      if (optionValue === true) optionValue = void 0;
      if (!optionValue) {
        if (optionValue === void 0 || optionValue === false) {
          return optionValue;
        }
        throw new Error(`\`${optionName}\` was specified but was not a node, or did not return a node`);
      }
      let node = optionValue;
      if (typeof optionValue === "string") {
        try {
          node = this.doc.querySelector(optionValue);
        } catch (err) {
          throw new Error(`\`${optionName}\` appears to be an invalid selector; error="${err.message}"`);
        }
        if (!node) {
          if (!hasFallback) {
            throw new Error(`\`${optionName}\` as selector refers to no known node`);
          }
        }
      }
      return node;
    });
    __publicField(this, "findNextNavNode", (opts) => {
      const { event, isBackward = false } = opts;
      const target = opts.target || getEventTarget(event);
      this.updateTabbableNodes();
      let destinationNode = null;
      if (this.state.tabbableGroups.length > 0) {
        const containerIndex = this.findContainerIndex(target, event);
        const containerGroup = containerIndex >= 0 ? this.state.containerGroups[containerIndex] : void 0;
        if (containerIndex < 0) {
          if (isBackward) {
            destinationNode = this.state.tabbableGroups[this.state.tabbableGroups.length - 1].lastTabbableNode;
          } else {
            destinationNode = this.state.tabbableGroups[0].firstTabbableNode;
          }
        } else if (isBackward) {
          let startOfGroupIndex = this.state.tabbableGroups.findIndex(
            ({ firstTabbableNode }) => target === firstTabbableNode
          );
          if (startOfGroupIndex < 0 && (containerGroup?.container === target || isFocusable(target) && !isTabbable(target) && !containerGroup?.nextTabbableNode(target, false))) {
            startOfGroupIndex = containerIndex;
          }
          if (startOfGroupIndex >= 0) {
            const destinationGroupIndex = startOfGroupIndex === 0 ? this.state.tabbableGroups.length - 1 : startOfGroupIndex - 1;
            const destinationGroup = this.state.tabbableGroups[destinationGroupIndex];
            destinationNode = getTabIndex(target) >= 0 ? destinationGroup.lastTabbableNode : destinationGroup.lastDomTabbableNode;
          } else if (!isTabEvent(event)) {
            destinationNode = containerGroup?.nextTabbableNode(target, false);
          }
        } else {
          let lastOfGroupIndex = this.state.tabbableGroups.findIndex(
            ({ lastTabbableNode }) => target === lastTabbableNode
          );
          if (lastOfGroupIndex < 0 && (containerGroup?.container === target || isFocusable(target) && !isTabbable(target) && !containerGroup?.nextTabbableNode(target))) {
            lastOfGroupIndex = containerIndex;
          }
          if (lastOfGroupIndex >= 0) {
            const destinationGroupIndex = lastOfGroupIndex === this.state.tabbableGroups.length - 1 ? 0 : lastOfGroupIndex + 1;
            const destinationGroup = this.state.tabbableGroups[destinationGroupIndex];
            destinationNode = getTabIndex(target) >= 0 ? destinationGroup.firstTabbableNode : destinationGroup.firstDomTabbableNode;
          } else if (!isTabEvent(event)) {
            destinationNode = containerGroup?.nextTabbableNode(target);
          }
        }
      } else {
        destinationNode = this.getNodeForOption("fallbackFocus");
      }
      return destinationNode;
    });
    this.trapStack = options.trapStack || sharedTrapStack;
    const config = {
      returnFocusOnDeactivate: true,
      escapeDeactivates: true,
      delayInitialFocus: true,
      followControlledElements: true,
      isKeyForward,
      isKeyBackward,
      ...options
    };
    this.doc = config.document || getDocument(Array.isArray(elements) ? elements[0] : elements);
    this.config = config;
    this.updateContainerElements(elements);
    this.setupMutationObserver();
  }
  addPortalContainer(controlledElement) {
    const portalContainer = controlledElement.parentElement;
    if (portalContainer && !this.portalContainers.has(portalContainer)) {
      this.portalContainers.add(portalContainer);
      if (this.state.active && !this.state.paused) {
        this.observePortalContainer(portalContainer);
      }
    }
  }
  observePortalContainer(portalContainer) {
    this._mutationObserver?.observe(portalContainer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-controls", "aria-expanded"]
    });
  }
  updatePortalContainers() {
    if (!this.config.followControlledElements) return;
    this.state.containers.forEach((container) => {
      const controlledElements = getControlledElements(container);
      controlledElements.forEach((controlledElement) => {
        this.addPortalContainer(controlledElement);
      });
    });
  }
  get active() {
    return this.state.active;
  }
  get paused() {
    return this.state.paused;
  }
  findContainerIndex(element, event) {
    const composedPath = typeof event?.composedPath === "function" ? event.composedPath() : void 0;
    return this.state.containerGroups.findIndex(
      ({ container, tabbableNodes }) => container.contains(element) || composedPath?.includes(container) || tabbableNodes.find((node) => node === element) || this.isControlledElement(container, element)
    );
  }
  isControlledElement(container, element) {
    if (!this.config.followControlledElements) return false;
    return isControlledElement(container, element);
  }
  updateTabbableNodes() {
    this.state.containerGroups = this.state.containers.map((container) => {
      const tabbableNodes = getTabbables(container, { getShadowRoot: this.config.getShadowRoot });
      const focusableNodes = getFocusables(container, { getShadowRoot: this.config.getShadowRoot });
      const firstTabbableNode = tabbableNodes[0];
      const lastTabbableNode = tabbableNodes[tabbableNodes.length - 1];
      const firstDomTabbableNode = firstTabbableNode;
      const lastDomTabbableNode = lastTabbableNode;
      let posTabIndexesFound = false;
      for (let i = 0; i < tabbableNodes.length; i++) {
        if (getTabIndex(tabbableNodes[i]) > 0) {
          posTabIndexesFound = true;
          break;
        }
      }
      function nextTabbableNode(node, forward = true) {
        const nodeIdx = tabbableNodes.indexOf(node);
        if (nodeIdx >= 0) {
          return tabbableNodes[nodeIdx + (forward ? 1 : -1)];
        }
        const focusableIdx = focusableNodes.indexOf(node);
        if (focusableIdx < 0) return void 0;
        if (forward) {
          for (let i = focusableIdx + 1; i < focusableNodes.length; i++) {
            if (isTabbable(focusableNodes[i])) return focusableNodes[i];
          }
        } else {
          for (let i = focusableIdx - 1; i >= 0; i--) {
            if (isTabbable(focusableNodes[i])) return focusableNodes[i];
          }
        }
        return void 0;
      }
      return {
        container,
        tabbableNodes,
        focusableNodes,
        posTabIndexesFound,
        firstTabbableNode,
        lastTabbableNode,
        firstDomTabbableNode,
        lastDomTabbableNode,
        nextTabbableNode
      };
    });
    this.state.tabbableGroups = this.state.containerGroups.filter((group) => group.tabbableNodes.length > 0);
    if (this.state.tabbableGroups.length <= 0 && !this.getNodeForOption("fallbackFocus")) {
      throw new Error(
        "Your focus-trap must have at least one container with at least one tabbable node in it at all times"
      );
    }
    if (this.state.containerGroups.find((g) => g.posTabIndexesFound) && this.state.containerGroups.length > 1) {
      throw new Error(
        "At least one node with a positive tabindex was found in one of your focus-trap's multiple containers. Positive tabindexes are only supported in single-container focus-traps."
      );
    }
  }
  addListeners() {
    if (!this.state.active) return;
    activeFocusTraps.activateTrap(this.trapStack, this);
    this.state.delayInitialFocusTimer = this.config.delayInitialFocus ? delay(() => {
      this.tryFocus(this.getInitialFocusNode());
    }) : this.tryFocus(this.getInitialFocusNode());
    this.listenerCleanups.push(
      addDomEvent(this.doc, "focusin", this.handleFocus, true),
      addDomEvent(this.doc, "mousedown", this.handlePointerDown, { capture: true, passive: false }),
      addDomEvent(this.doc, "touchstart", this.handlePointerDown, { capture: true, passive: false }),
      addDomEvent(this.doc, "click", this.handleClick, { capture: true, passive: false }),
      addDomEvent(this.doc, "keydown", this.handleTabKey, { capture: true, passive: false }),
      addDomEvent(this.doc, "keydown", this.handleEscapeKey)
    );
    return this;
  }
  removeListeners() {
    if (!this.state.active) return;
    this.listenerCleanups.forEach((cleanup) => cleanup());
    this.listenerCleanups = [];
    return this;
  }
  activate(activateOptions) {
    if (this.state.active) {
      return this;
    }
    const onActivate = this.getOption(activateOptions, "onActivate");
    const onPostActivate = this.getOption(activateOptions, "onPostActivate");
    const checkCanFocusTrap = this.getOption(activateOptions, "checkCanFocusTrap");
    if (!checkCanFocusTrap) {
      this.updateTabbableNodes();
    }
    this.state.active = true;
    this.state.paused = false;
    this.state.nodeFocusedBeforeActivation = getActiveElement(this.doc);
    onActivate?.();
    const finishActivation = () => {
      if (checkCanFocusTrap) {
        this.updateTabbableNodes();
      }
      this.addListeners();
      this.updateObservedNodes();
      onPostActivate?.();
    };
    if (checkCanFocusTrap) {
      checkCanFocusTrap(this.state.containers.concat()).then(finishActivation, finishActivation);
      return this;
    }
    finishActivation();
    return this;
  }
};
var isKeyboardEvent = (event) => event?.type === "keydown";
var isTabEvent = (event) => isKeyboardEvent(event) && event?.key === "Tab";
var isKeyForward = (e) => isKeyboardEvent(e) && e.key === "Tab" && !e?.shiftKey;
var isKeyBackward = (e) => isKeyboardEvent(e) && e.key === "Tab" && e?.shiftKey;
var valueOrHandler = (value, ...params) => typeof value === "function" ? value(...params) : value;
var isEscapeEvent = (event) => !event.isComposing && event.key === "Escape";
var delay = (fn) => setTimeout(fn, 0);
var isSelectableInput = (node) => node.localName === "input" && "select" in node && typeof node.select === "function";

// node_modules/@zag-js/focus-trap/dist/index.mjs
function trapFocus(el, options = {}) {
  let trap;
  const cleanup = raf(() => {
    const elements = Array.isArray(el) ? el : [el];
    const resolvedElements = elements.map((e) => typeof e === "function" ? e() : e).filter((e) => e != null);
    if (resolvedElements.length === 0) return;
    const primaryEl = resolvedElements[0];
    trap = new FocusTrap(resolvedElements, {
      escapeDeactivates: false,
      allowOutsideClick: true,
      preventScroll: true,
      returnFocusOnDeactivate: true,
      delayInitialFocus: false,
      fallbackFocus: primaryEl,
      ...options,
      document: getDocument(primaryEl)
    });
    try {
      trap.activate();
    } catch {
    }
  });
  return function destroy() {
    trap?.deactivate();
    cleanup();
  };
}

// node_modules/@zag-js/remove-scroll/dist/index.mjs
var LOCK_CLASSNAME = "data-scroll-lock";
function getPaddingProperty(documentElement) {
  const documentLeft = documentElement.getBoundingClientRect().left;
  const scrollbarX = Math.round(documentLeft) + documentElement.scrollLeft;
  return scrollbarX ? "paddingLeft" : "paddingRight";
}
function hasStableScrollbarGutter(element) {
  const styles = getComputedStyle(element);
  const scrollbarGutter = styles?.scrollbarGutter;
  return scrollbarGutter === "stable" || scrollbarGutter?.startsWith("stable ") === true;
}
function preventBodyScroll(_document) {
  const doc = _document ?? document;
  const win = doc.defaultView ?? window;
  const { documentElement, body } = doc;
  const locked = body.hasAttribute(LOCK_CLASSNAME);
  if (locked) return;
  const hasStableGutter = hasStableScrollbarGutter(documentElement) || hasStableScrollbarGutter(body);
  const scrollbarWidth = win.innerWidth - documentElement.clientWidth;
  body.setAttribute(LOCK_CLASSNAME, "");
  const setScrollbarWidthProperty = () => setStyleProperty(documentElement, "--scrollbar-width", `${scrollbarWidth}px`);
  const paddingProperty = getPaddingProperty(documentElement);
  const setBodyStyle = () => {
    const styles = {
      overflow: "hidden"
    };
    if (!hasStableGutter && scrollbarWidth > 0) {
      styles[paddingProperty] = `${scrollbarWidth}px`;
    }
    return setStyle(body, styles);
  };
  const setBodyStyleIOS = () => {
    const { scrollX, scrollY, visualViewport } = win;
    const offsetLeft = visualViewport?.offsetLeft ?? 0;
    const offsetTop = visualViewport?.offsetTop ?? 0;
    const styles = {
      position: "fixed",
      overflow: "hidden",
      top: `${-(scrollY - Math.floor(offsetTop))}px`,
      left: `${-(scrollX - Math.floor(offsetLeft))}px`,
      right: "0"
    };
    if (!hasStableGutter && scrollbarWidth > 0) {
      styles[paddingProperty] = `${scrollbarWidth}px`;
    }
    const restoreStyle = setStyle(body, styles);
    return () => {
      restoreStyle?.();
      win.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    };
  };
  const cleanups = [setScrollbarWidthProperty(), isIos() ? setBodyStyleIOS() : setBodyStyle()];
  return () => {
    cleanups.forEach((fn) => fn?.());
    body.removeAttribute(LOCK_CLASSNAME);
  };
}

// node_modules/@zag-js/popover/dist/popover.machine.mjs
var machine = createMachine({
  props({ props: props2 }) {
    return {
      closeOnInteractOutside: true,
      closeOnEscape: true,
      autoFocus: true,
      modal: false,
      portalled: true,
      ...props2,
      translations: {
        closeTriggerLabel: "close",
        ...props2.translations
      },
      positioning: {
        placement: "bottom",
        ...props2.positioning
      }
    };
  },
  initialState({ prop }) {
    const open = prop("open") || prop("defaultOpen");
    return open ? "open" : "closed";
  },
  context({ bindable, prop, scope }) {
    return {
      currentPlacement: bindable(() => ({
        defaultValue: void 0
      })),
      renderedElements: bindable(() => ({
        defaultValue: { title: true, description: true }
      })),
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
    };
  },
  computed: {
    currentPortalled: ({ prop }) => !!prop("modal") || !!prop("portalled")
  },
  watch({ track, prop, action }) {
    track([() => prop("open")], () => {
      action(["toggleVisibility"]);
    });
  },
  entry: ["checkRenderedElements"],
  on: {
    "TRIGGER_VALUE.SET": {
      actions: ["setTriggerValue", "reposition"]
    }
  },
  states: {
    closed: {
      on: {
        "CONTROLLED.OPEN": {
          target: "open",
          actions: ["setInitialFocus"]
        },
        TOGGLE: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen", "setTriggerValue"]
          },
          {
            target: "open",
            actions: ["invokeOnOpen", "setTriggerValue", "setInitialFocus"]
          }
        ],
        OPEN: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnOpen", "setTriggerValue"]
          },
          {
            target: "open",
            actions: ["invokeOnOpen", "setTriggerValue", "setInitialFocus"]
          }
        ]
      }
    },
    open: {
      effects: [
        "trapFocus",
        "preventScroll",
        "hideContentBelow",
        "trackDismissableElement",
        "trackPositioning",
        "proxyTabFocus"
      ],
      on: {
        "CONTROLLED.CLOSE": {
          target: "closed",
          actions: ["setFinalFocus"]
        },
        CLOSE: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose", "setFinalFocus"]
          }
        ],
        TOGGLE: [
          {
            guard: "isOpenControlled",
            actions: ["invokeOnClose"]
          },
          {
            target: "closed",
            actions: ["invokeOnClose"]
          }
        ],
        "POSITIONING.SET": {
          actions: ["reposition"]
        }
      }
    }
  },
  implementations: {
    guards: {
      isOpenControlled: ({ prop }) => prop("open") != void 0
    },
    effects: {
      trackPositioning({ context, prop, scope }) {
        context.set("currentPlacement", prop("positioning").placement);
        const anchorEl = getAnchorEl(scope);
        const getPositionerEl2 = () => getPositionerEl(scope);
        const getTriggerEl = () => anchorEl ?? getActiveTriggerEl(scope, context.get("triggerValue"));
        return getPlacement(getTriggerEl, getPositionerEl2, {
          ...prop("positioning"),
          defer: true,
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      trackDismissableElement({ send, prop, scope }) {
        const getContentEl2 = () => getContentEl(scope);
        let restoreFocus = true;
        return trackDismissableElement(getContentEl2, {
          type: "popover",
          pointerBlocking: prop("modal"),
          exclude: getTriggerEls(scope),
          defer: true,
          onEscapeKeyDown(event) {
            prop("onEscapeKeyDown")?.(event);
            if (prop("closeOnEscape")) return;
            event.preventDefault();
          },
          onInteractOutside(event) {
            prop("onInteractOutside")?.(event);
            if (event.defaultPrevented) return;
            restoreFocus = !(event.detail.focusable || event.detail.contextmenu);
            if (!prop("closeOnInteractOutside")) {
              event.preventDefault();
            }
          },
          onPointerDownOutside: prop("onPointerDownOutside"),
          onFocusOutside: prop("onFocusOutside"),
          persistentElements: prop("persistentElements"),
          onRequestDismiss: prop("onRequestDismiss"),
          onDismiss() {
            send({ type: "CLOSE", src: "interact-outside", restoreFocus });
          }
        });
      },
      proxyTabFocus({ prop, scope, context }) {
        if (prop("modal") || !prop("portalled")) return;
        const getContentEl2 = () => getContentEl(scope);
        return proxyTabFocus(getContentEl2, {
          triggerElement: getActiveTriggerEl(scope, context.get("triggerValue")),
          defer: true,
          getShadowRoot: true,
          onFocus(el) {
            el.focus({ preventScroll: true });
          }
        });
      },
      hideContentBelow({ prop, scope, context }) {
        if (!prop("modal")) return;
        const getElements = () => [getContentEl(scope), getActiveTriggerEl(scope, context.get("triggerValue"))];
        return ariaHidden(getElements, { defer: true });
      },
      preventScroll({ prop, scope }) {
        if (!prop("modal")) return;
        return preventBodyScroll(scope.getDoc());
      },
      trapFocus({ prop, scope }) {
        if (!prop("modal")) return;
        const contentEl = () => getContentEl(scope);
        return trapFocus(contentEl, {
          initialFocus: () => getInitialFocus({
            root: getContentEl(scope),
            getInitialEl: prop("initialFocusEl"),
            enabled: prop("autoFocus")
          }),
          getShadowRoot: true
        });
      }
    },
    actions: {
      reposition({ event, prop, scope, context }) {
        const anchorEl = getAnchorEl(scope);
        const getPositionerEl2 = () => getPositionerEl(scope);
        const getTriggerEl = () => anchorEl ?? getActiveTriggerEl(scope, context.get("triggerValue"));
        getPlacement(getTriggerEl, getPositionerEl2, {
          ...prop("positioning"),
          ...event.options,
          defer: true,
          listeners: false,
          onComplete(data) {
            context.set("currentPlacement", data.placement);
          }
        });
      },
      setTriggerValue({ context, event }) {
        if (event.value === void 0) return;
        context.set("triggerValue", event.value);
      },
      checkRenderedElements({ context, scope }) {
        raf(() => {
          Object.assign(context.get("renderedElements"), {
            title: !!getTitleEl(scope),
            description: !!getDescriptionEl(scope)
          });
        });
      },
      setInitialFocus({ prop, scope }) {
        if (prop("modal")) return;
        raf(() => {
          const element = getInitialFocus({
            root: getContentEl(scope),
            getInitialEl: prop("initialFocusEl"),
            enabled: prop("autoFocus")
          });
          element?.focus({ preventScroll: true });
        });
      },
      setFinalFocus({ event, scope, context }) {
        const restoreFocus = event.restoreFocus ?? event.previousEvent?.restoreFocus;
        if (restoreFocus != null && !restoreFocus) return;
        raf(() => {
          const element = getActiveTriggerEl(scope, context.get("triggerValue"));
          element?.focus({ preventScroll: true });
        });
      },
      invokeOnOpen({ prop, flush }) {
        flush(() => {
          prop("onOpenChange")?.({ open: true });
        });
      },
      invokeOnClose({ prop, flush }) {
        flush(() => {
          prop("onOpenChange")?.({ open: false });
        });
      },
      toggleVisibility({ event, send, prop }) {
        send({ type: prop("open") ? "CONTROLLED.OPEN" : "CONTROLLED.CLOSE", previousEvent: event });
      }
    }
  }
});

// node_modules/@zag-js/popover/dist/popover.props.mjs
var props = createProps()([
  "autoFocus",
  "closeOnEscape",
  "closeOnInteractOutside",
  "defaultOpen",
  "defaultTriggerValue",
  "dir",
  "getRootNode",
  "id",
  "ids",
  "initialFocusEl",
  "modal",
  "onEscapeKeyDown",
  "onFocusOutside",
  "onInteractOutside",
  "onOpenChange",
  "onPointerDownOutside",
  "onTriggerValueChange",
  "onRequestDismiss",
  "open",
  "persistentElements",
  "portalled",
  "positioning",
  "translations",
  "triggerValue"
]);
var splitProps = createSplitProps2(props);

// node_modules/@ark-ui/solid/dist/chunk/3F3O2MOY.js
var [PopoverProvider, usePopoverContext] = createContext({
  hookName: "usePopoverContext",
  providerName: "<PopoverProvider />"
});
var PopoverAnchor = (props2) => {
  const api = usePopoverContext();
  const mergedProps = mergeProps2(() => api().getAnchorProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var PopoverArrow = (props2) => {
  const popover2 = usePopoverContext();
  const mergedProps = mergeProps2(() => popover2().getArrowProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var PopoverArrowTip = (props2) => {
  const popover2 = usePopoverContext();
  const mergedProps = mergeProps2(() => popover2().getArrowTipProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var PopoverCloseTrigger = (props2) => {
  const api = usePopoverContext();
  const mergedProps = mergeProps2(() => api().getCloseTriggerProps(), props2);
  return createComponent(ark.button, mergedProps);
};
var PopoverContent = (props2) => {
  const api = usePopoverContext();
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
var PopoverContext = (props2) => props2.children(usePopoverContext());
var PopoverDescription = (props2) => {
  const api = usePopoverContext();
  const mergedProps = mergeProps2(() => api().getDescriptionProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var PopoverIndicator = (props2) => {
  const popover2 = usePopoverContext();
  const mergedProps = mergeProps2(() => popover2().getIndicatorProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var PopoverPositioner = (props2) => {
  const api = usePopoverContext();
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
var usePopover = (props2) => {
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
var PopoverRoot = (props2) => {
  const [presenceProps, popoverProps] = splitPresenceProps(props2);
  const [usePopoverProps, localProps] = createSplitProps()(popoverProps, ["autoFocus", "closeOnEscape", "closeOnInteractOutside", "defaultOpen", "id", "ids", "initialFocusEl", "modal", "onEscapeKeyDown", "onFocusOutside", "onInteractOutside", "onOpenChange", "onPointerDownOutside", "onRequestDismiss", "open", "persistentElements", "portalled", "positioning", "translations", "triggerValue", "defaultTriggerValue", "onTriggerValueChange"]);
  const api = usePopover(usePopoverProps);
  const apiPresence = usePresence(mergeProps2(presenceProps, () => ({
    present: api().open
  })));
  return createComponent(PopoverProvider, {
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
var PopoverRootProvider = (props2) => {
  const [presenceProps, popoverProps] = splitPresenceProps(props2);
  const presence = usePresence(mergeProps2(presenceProps, () => ({
    present: popoverProps.value().open
  })));
  return createComponent(PopoverProvider, {
    get value() {
      return popoverProps.value;
    },
    get children() {
      return createComponent(PresenceProvider, {
        value: presence,
        get children() {
          return popoverProps.children;
        }
      });
    }
  });
};
var PopoverTitle = (props2) => {
  const api = usePopoverContext();
  const mergedProps = mergeProps2(() => api().getTitleProps(), props2);
  return createComponent(ark.div, mergedProps);
};
var PopoverTrigger = (props2) => {
  const [triggerProps, localProps] = createSplitProps()(props2, ["value"]);
  const api = usePopoverContext();
  const presenceApi = usePresenceContext();
  const mergedProps = mergeProps2(() => api().getTriggerProps(triggerProps), () => ({
    "aria-controls": presenceApi().unmounted && null
  }), localProps);
  return createComponent(ark.button, mergedProps);
};
var popover_exports = {};
__export(popover_exports, {
  Anchor: () => PopoverAnchor,
  Arrow: () => PopoverArrow,
  ArrowTip: () => PopoverArrowTip,
  CloseTrigger: () => PopoverCloseTrigger,
  Content: () => PopoverContent,
  Context: () => PopoverContext,
  Description: () => PopoverDescription,
  Indicator: () => PopoverIndicator,
  Positioner: () => PopoverPositioner,
  Root: () => PopoverRoot,
  RootProvider: () => PopoverRootProvider,
  Title: () => PopoverTitle,
  Trigger: () => PopoverTrigger
});
export {
  popover_exports as Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverArrowTip,
  PopoverCloseTrigger,
  PopoverContent,
  PopoverContext,
  PopoverDescription,
  PopoverIndicator,
  PopoverPositioner,
  PopoverRoot,
  PopoverRootProvider,
  PopoverTitle,
  PopoverTrigger,
  anatomy as popoverAnatomy,
  usePopover,
  usePopoverContext
};
//# sourceMappingURL=@ark-ui_solid_popover.js.map
