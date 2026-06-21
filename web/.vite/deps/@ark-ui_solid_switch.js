import {
  isFocusVisible,
  trackFocusVisible
} from "./chunk-FFK77TTL.js";
import {
  composeRefs
} from "./chunk-H6FIBI44.js";
import {
  __export,
  ariaAttr,
  ark,
  createAnatomy,
  createContext,
  createGuards,
  createMachine,
  createProps,
  createSplitProps,
  createSplitProps2,
  dataAttr,
  dispatchInputCheckedEvent,
  getComputedStyle,
  getDocument,
  getEventTarget,
  getWindow,
  isSafari,
  mergeProps as mergeProps2,
  normalizeProps,
  runIfFn,
  setElementChecked,
  trackFormControl,
  trackPress,
  useEnvironmentContext,
  useLocaleContext,
  useMachine,
  visuallyHiddenStyle
} from "./chunk-GXWXGF3R.js";
import "./chunk-B3FRG6SU.js";
import {
  Show,
  createComponent,
  createMemo,
  createSignal,
  createUniqueId,
  mergeProps,
  onCleanup,
  onMount,
  splitProps
} from "./chunk-JNFR4PU6.js";
import "./chunk-5WRI5ZAA.js";

// node_modules/@ark-ui/solid/dist/chunk/FCMJTSIR.js
var fieldsetAnatomy = createAnatomy("fieldset").parts("root", "errorText", "helperText", "legend");
var parts = fieldsetAnatomy.build();

// node_modules/@ark-ui/solid/dist/chunk/37BRFTCN.js
var [FieldsetProvider, useFieldsetContext] = createContext({
  hookName: "useFieldsetContext",
  providerName: "<FieldsetProvider />",
  strict: false
});
var FieldsetContext = (props2) => props2.children(useFieldsetContext());
var FieldsetErrorText = (props2) => {
  const fieldset = useFieldsetContext();
  const mergedProps = mergeProps2(() => fieldset().getErrorTextProps(), props2);
  return createComponent(Show, {
    get when() {
      return fieldset().invalid;
    },
    get children() {
      return createComponent(ark.span, mergedProps);
    }
  });
};
var FieldsetHelperText = (props2) => {
  const fieldset = useFieldsetContext();
  const mergedProps = mergeProps2(() => fieldset().getHelperTextProps(), props2);
  return createComponent(ark.span, mergedProps);
};
var FieldsetLegend = (props2) => {
  const fieldset = useFieldsetContext();
  const mergedProps = mergeProps2(() => fieldset().getLegendProps(), props2);
  return createComponent(ark.legend, mergedProps);
};
var useFieldset = (props2) => {
  const env = useEnvironmentContext();
  const mergedProps = mergeProps({ disabled: false, invalid: false }, runIfFn(props2));
  const [rootRef, setRootRef] = createSignal(void 0);
  const id = mergedProps.id ?? createUniqueId();
  const legendId = `fieldset::${id}::legend`;
  const errorTextId = `fieldset::${id}::error-text`;
  const helperTextId = `fieldset::${id}::helper-text`;
  const [hasErrorText, setHasErrorText] = createSignal(false);
  const [hasHelperText, setHasHelperText] = createSignal(false);
  onMount(() => {
    const rootNode = rootRef();
    if (!rootNode) return;
    const checkTextElements = () => {
      const docOrShadowRoot = env().getRootNode();
      setHasErrorText(!!docOrShadowRoot.getElementById(errorTextId));
      setHasHelperText(!!docOrShadowRoot.getElementById(helperTextId));
    };
    checkTextElements();
    const win = env().getWindow();
    const observer = new win.MutationObserver(checkTextElements);
    observer.observe(rootNode, { childList: true, subtree: true });
    onCleanup(() => observer.disconnect());
  });
  const labelIds = createMemo(() => {
    const ids = [];
    if (hasErrorText() && mergedProps.invalid) ids.push(errorTextId);
    if (hasHelperText()) ids.push(helperTextId);
    return ids;
  });
  const getRootProps = () => ({
    ...parts.root.attrs,
    disabled: mergedProps.disabled,
    "data-disabled": dataAttr(mergedProps.disabled),
    "data-invalid": dataAttr(mergedProps.invalid),
    "aria-labelledby": legendId,
    "aria-describedby": labelIds().join(" ") || void 0
  });
  const getLegendProps = () => ({
    id: legendId,
    ...parts.legend.attrs,
    "data-disabled": dataAttr(mergedProps.disabled),
    "data-invalid": dataAttr(mergedProps.invalid)
  });
  const getHelperTextProps = () => ({
    id: helperTextId,
    ...parts.helperText.attrs
  });
  const getErrorTextProps = () => ({
    id: errorTextId,
    ...parts.errorText.attrs,
    "aria-live": "polite"
  });
  return createMemo(() => ({
    refs: {
      rootRef: setRootRef
    },
    ids: {
      legend: legendId,
      errorText: errorTextId,
      helperText: helperTextId
    },
    disabled: mergedProps.disabled,
    invalid: mergedProps.invalid,
    getRootProps,
    getLegendProps,
    getHelperTextProps,
    getErrorTextProps
  }));
};
var FieldsetRoot = (props2) => {
  const [useFieldsetProps, localProps] = createSplitProps()(props2, ["id", "disabled", "invalid"]);
  const fieldset = useFieldset(useFieldsetProps);
  const mergedProps = mergeProps2(() => fieldset().getRootProps(), localProps);
  return createComponent(FieldsetProvider, {
    value: fieldset,
    get children() {
      return createComponent(ark.fieldset, mergeProps(mergedProps, {
        ref(r$) {
          var _ref$ = composeRefs(fieldset().refs.rootRef, props2.ref);
          typeof _ref$ === "function" && _ref$(r$);
        }
      }));
    }
  });
};
FieldsetRoot.displayName = "FieldsetRoot";
var FieldsetRootProvider = (props2) => {
  const [{
    value: fieldset
  }, localProps] = createSplitProps()(props2, ["value"]);
  const mergedProps = mergeProps2(() => fieldset().getRootProps(), localProps);
  return createComponent(FieldsetProvider, {
    value: fieldset,
    get children() {
      return createComponent(ark.fieldset, mergedProps);
    }
  });
};
var fieldset_exports = {};
__export(fieldset_exports, {
  Context: () => FieldsetContext,
  ErrorText: () => FieldsetErrorText,
  HelperText: () => FieldsetHelperText,
  Legend: () => FieldsetLegend,
  Root: () => FieldsetRoot,
  RootProvider: () => FieldsetRootProvider
});

// node_modules/@ark-ui/solid/dist/chunk/DAGJUXUK.js
var fieldAnatomy = createAnatomy("field").parts(
  "root",
  "errorText",
  "helperText",
  "input",
  "label",
  "select",
  "textarea",
  "requiredIndicator"
);
var parts2 = fieldAnatomy.build();

// node_modules/@zag-js/auto-resize/dist/autoresize-textarea.mjs
var autoresizeTextarea = (el) => {
  if (!el) return;
  const style = getComputedStyle(el);
  const win = getWindow(el);
  const doc = getDocument(el);
  const resize = () => {
    requestAnimationFrame(() => {
      el.style.height = "auto";
      let newHeight;
      if (style.boxSizing === "content-box") {
        newHeight = el.scrollHeight - (parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
      } else {
        newHeight = el.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      }
      if (style.maxHeight !== "none" && newHeight > parseFloat(style.maxHeight)) {
        if (style.overflowY === "hidden") {
          el.style.overflowY = "scroll";
        }
        newHeight = parseFloat(style.maxHeight);
      } else if (style.overflowY !== "hidden") {
        el.style.overflowY = "hidden";
      }
      el.style.height = `${newHeight}px`;
    });
  };
  el.addEventListener("input", resize);
  el.form?.addEventListener("reset", resize);
  const elementPrototype = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(elementPrototype, "value");
  if (descriptor) {
    Object.defineProperty(el, "value", {
      ...descriptor,
      set(newValue) {
        const prevValue = descriptor.get?.call(this);
        descriptor.set?.call(this, newValue);
        resize();
        if (prevValue !== newValue) {
          queueMicrotask(() => {
            el.dispatchEvent(new win.InputEvent("input", { bubbles: true }));
          });
        }
      }
    });
  }
  const resizeObserver = new win.ResizeObserver(() => {
    requestAnimationFrame(() => resize());
  });
  resizeObserver.observe(el);
  const attrObserver = new win.MutationObserver(() => resize());
  attrObserver.observe(el, { attributes: true, attributeFilter: ["rows", "placeholder"] });
  doc.fonts?.addEventListener("loadingdone", resize);
  return () => {
    el.removeEventListener("input", resize);
    el.form?.removeEventListener("reset", resize);
    doc.fonts?.removeEventListener("loadingdone", resize);
    resizeObserver.disconnect();
    attrObserver.disconnect();
  };
};

// node_modules/@ark-ui/solid/dist/chunk/UJB7LDER.js
var [FieldProvider, useFieldContext] = createContext({
  hookName: "useFieldContext",
  providerName: "<FieldProvider />",
  strict: false
});
var FieldContext = (props2) => props2.children(useFieldContext());
var FieldErrorText = (props2) => {
  const field = useFieldContext();
  const mergedProps = mergeProps2(() => field().getErrorTextProps(), props2);
  return createComponent(Show, {
    get when() {
      return field?.().invalid;
    },
    get children() {
      return createComponent(ark.span, mergedProps);
    }
  });
};
var FieldHelperText = (props2) => {
  const field = useFieldContext();
  const mergedProps = mergeProps2(() => field().getHelperTextProps(), props2);
  return createComponent(ark.span, mergedProps);
};
var FieldInput = (props2) => {
  const field = useFieldContext();
  const mergedProps = mergeProps2(() => field?.().getInputProps(), props2);
  return createComponent(ark.input, mergedProps);
};
var FieldLabel = (props2) => {
  const field = useFieldContext();
  const mergedProps = mergeProps2(() => field?.().getLabelProps(), props2);
  return createComponent(ark.label, mergedProps);
};
var FieldRequiredIndicator = (props2) => {
  const field = useFieldContext();
  const mergedProps = mergeProps2(() => field().getRequiredIndicatorProps(), props2);
  return createComponent(Show, {
    get when() {
      return field().required;
    },
    get fallback() {
      return props2.fallback;
    },
    get children() {
      return createComponent(ark.span, mergeProps(mergedProps, {
        get children() {
          return props2.children ?? "*";
        }
      }));
    }
  });
};
var useField = (props2) => {
  const fieldset = useFieldsetContext();
  const env = useEnvironmentContext();
  const fieldProps = mergeProps(
    { disabled: Boolean(fieldset?.().disabled), required: false, invalid: false, readOnly: false },
    props2
  );
  const [hasErrorText, setHasErrorText] = createSignal(false);
  const [hasHelperText, setHasHelperText] = createSignal(false);
  const id = fieldProps.id ?? createUniqueId();
  const [rootRef, setRootRef] = createSignal(void 0);
  const rootId = fieldProps.ids?.control ?? `field::${id}`;
  const errorTextId = fieldProps.ids?.errorText ?? `field::${id}::error-text`;
  const helperTextId = fieldProps.ids?.helperText ?? `field::${id}::helper-text`;
  const labelId = fieldProps.ids?.label ?? `field::${id}::label`;
  onMount(() => {
    const rootNode = rootRef();
    if (!rootNode) return;
    const checkTextElements = () => {
      const docOrShadowRoot = env().getRootNode();
      setHasErrorText(!!docOrShadowRoot.getElementById(errorTextId));
      setHasHelperText(!!docOrShadowRoot.getElementById(helperTextId));
    };
    checkTextElements();
    const win = env().getWindow();
    const observer = new win.MutationObserver(checkTextElements);
    observer.observe(rootNode, { childList: true, subtree: true });
    onCleanup(() => observer.disconnect());
  });
  const getRootProps = () => ({
    ...parts2.root.attrs,
    id: rootId,
    role: "group",
    "data-disabled": dataAttr(fieldProps.disabled),
    "data-invalid": dataAttr(fieldProps.invalid),
    "data-readonly": dataAttr(fieldProps.readOnly)
  });
  const targetControlId = fieldProps.target ? `field::${id}::item::${fieldProps.target}` : void 0;
  const getLabelProps = () => ({
    ...parts2.label.attrs,
    id: labelId,
    "data-disabled": dataAttr(fieldProps.disabled),
    "data-invalid": dataAttr(fieldProps.invalid),
    "data-readonly": dataAttr(fieldProps.readOnly),
    "data-required": dataAttr(fieldProps.required),
    htmlFor: targetControlId ?? id
  });
  const labelIds = createMemo(() => {
    const ids = [];
    if (hasErrorText() && fieldProps.invalid) ids.push(errorTextId);
    if (hasHelperText()) ids.push(helperTextId);
    return ids;
  });
  const getControlProps = () => ({
    "aria-describedby": labelIds().join(" ") || void 0,
    "aria-invalid": ariaAttr(fieldProps.invalid),
    "data-invalid": dataAttr(fieldProps.invalid),
    "data-required": dataAttr(fieldProps.required),
    "data-readonly": dataAttr(fieldProps.readOnly),
    id,
    required: fieldProps.required,
    disabled: fieldProps.disabled,
    readOnly: fieldProps.readOnly || void 0
  });
  const getInputProps = () => ({
    ...getControlProps(),
    ...parts2.input.attrs
  });
  const getTextareaProps = () => ({
    ...getControlProps(),
    ...parts2.textarea.attrs
  });
  const getSelectProps = () => ({
    ...getControlProps(),
    ...parts2.select.attrs
  });
  const getHelperTextProps = () => ({
    id: helperTextId,
    ...parts2.helperText.attrs,
    "data-disabled": dataAttr(fieldProps.disabled)
  });
  const getErrorTextProps = () => ({
    id: errorTextId,
    ...parts2.errorText.attrs,
    "aria-live": "polite"
  });
  const getRequiredIndicatorProps = () => ({
    "aria-hidden": true,
    ...parts2.requiredIndicator.attrs
  });
  return createMemo(() => ({
    ariaDescribedby: labelIds().join(" "),
    ids: {
      control: id,
      label: labelId,
      errorText: errorTextId,
      helperText: helperTextId
    },
    refs: {
      rootRef: setRootRef
    },
    disabled: fieldProps.disabled,
    invalid: fieldProps.invalid,
    readOnly: fieldProps.readOnly,
    required: fieldProps.required,
    getLabelProps,
    getRootProps,
    getInputProps,
    getTextareaProps,
    getSelectProps,
    getHelperTextProps,
    getErrorTextProps,
    getRequiredIndicatorProps
  }));
};
var FieldRoot = (props2) => {
  const [useFieldProps, localProps] = createSplitProps()(props2, ["id", "ids", "disabled", "invalid", "readOnly", "required", "target"]);
  const field = useField(useFieldProps);
  const mergedProps = mergeProps2(() => field().getRootProps(), localProps);
  return createComponent(FieldProvider, {
    value: field,
    get children() {
      return createComponent(ark.div, mergeProps(mergedProps, {
        ref(r$) {
          var _ref$ = composeRefs(field().refs.rootRef, props2.ref);
          typeof _ref$ === "function" && _ref$(r$);
        }
      }));
    }
  });
};
var FieldRootProvider = (props2) => {
  const [{
    value: field
  }, localProps] = createSplitProps()(props2, ["value"]);
  const mergedProps = mergeProps2(() => field().getRootProps(), localProps);
  return createComponent(FieldProvider, {
    value: field,
    get children() {
      return createComponent(ark.div, mergedProps);
    }
  });
};
var FieldSelect = (props2) => {
  const field = useFieldContext();
  const mergedProps = mergeProps2(() => field?.().getSelectProps(), props2);
  return createComponent(ark.select, mergedProps);
};
var FieldTextarea = (props2) => {
  const field = useFieldContext();
  let textareaRef;
  const [autoresizeProps, textareaProps] = splitProps(props2, ["autoresize"]);
  const mergedProps = mergeProps2(() => field?.().getTextareaProps(), () => ({
    style: {
      resize: autoresizeProps.autoresize ? "none" : void 0
    }
  }), textareaProps);
  onMount(() => {
    if (!autoresizeProps.autoresize) return;
    const cleanup = autoresizeTextarea(textareaRef);
    onCleanup(() => cleanup?.());
  });
  return createComponent(ark.textarea, mergeProps(mergedProps, {
    ref(r$) {
      var _ref$ = composeRefs((el) => textareaRef = el, props2.ref);
      typeof _ref$ === "function" && _ref$(r$);
    }
  }));
};
var field_exports = {};
__export(field_exports, {
  Context: () => FieldContext,
  ErrorText: () => FieldErrorText,
  HelperText: () => FieldHelperText,
  Input: () => FieldInput,
  Item: () => FieldItem,
  Label: () => FieldLabel,
  RequiredIndicator: () => FieldRequiredIndicator,
  Root: () => FieldRoot,
  RootProvider: () => FieldRootProvider,
  Select: () => FieldSelect,
  Textarea: () => FieldTextarea
});
var FieldItem = (props2) => {
  const parentField = useFieldContext();
  const itemField = createMemo(() => {
    const parent = parentField?.();
    if (!parent) {
      throw new Error("Field.Item must be used within Field.Root");
    }
    const controlId = `field::${parent.ids.control}::item::${props2.value}`;
    const labelId = `${controlId}::label`;
    const getControlProps = () => ({
      ...parent.getInputProps(),
      id: controlId
    });
    return () => ({
      ...parent,
      ids: {
        ...parent.ids,
        control: controlId,
        label: labelId
      },
      getLabelProps: () => ({
        ...parent.getLabelProps(),
        id: labelId,
        htmlFor: controlId
      }),
      getInputProps: () => ({
        ...getControlProps(),
        ...parts2.input.attrs
      }),
      getSelectProps: () => ({
        ...getControlProps(),
        ...parts2.select.attrs
      }),
      getTextareaProps: () => ({
        ...getControlProps(),
        ...parts2.textarea.attrs
      })
    });
  });
  return createComponent(FieldProvider, {
    get value() {
      return itemField();
    },
    get children() {
      return props2.children;
    }
  });
};

// node_modules/@zag-js/switch/dist/switch.anatomy.mjs
var anatomy = createAnatomy("switch").parts("root", "label", "control", "thumb");
var parts3 = anatomy.build();

// node_modules/@zag-js/switch/dist/switch.dom.mjs
var getRootId = (ctx) => ctx.ids?.root ?? `switch:${ctx.id}`;
var getLabelId = (ctx) => ctx.ids?.label ?? `switch:${ctx.id}:label`;
var getThumbId = (ctx) => ctx.ids?.thumb ?? `switch:${ctx.id}:thumb`;
var getControlId = (ctx) => ctx.ids?.control ?? `switch:${ctx.id}:control`;
var getHiddenInputId = (ctx) => ctx.ids?.hiddenInput ?? `switch:${ctx.id}:input`;
var getRootEl = (ctx) => ctx.getById(getRootId(ctx));
var getHiddenInputEl = (ctx) => ctx.getById(getHiddenInputId(ctx));

// node_modules/@zag-js/switch/dist/switch.connect.mjs
function connect(service, normalize) {
  const { context, send, prop, scope } = service;
  const disabled = !!prop("disabled");
  const readOnly = !!prop("readOnly");
  const required = !!prop("required");
  const checked = !!context.get("checked");
  const focused = !disabled && context.get("focused");
  const focusVisible = !disabled && context.get("focusVisible");
  const active = !disabled && context.get("active");
  const dataAttrs = {
    "data-active": dataAttr(active),
    "data-focus": dataAttr(focused),
    "data-focus-visible": dataAttr(focusVisible),
    "data-readonly": dataAttr(readOnly),
    "data-hover": dataAttr(context.get("hovered")),
    "data-disabled": dataAttr(disabled),
    "data-state": checked ? "checked" : "unchecked",
    "data-invalid": dataAttr(prop("invalid")),
    "data-required": dataAttr(required)
  };
  return {
    checked,
    disabled,
    focused,
    setChecked(checked2) {
      send({ type: "CHECKED.SET", checked: checked2, isTrusted: false });
    },
    toggleChecked() {
      send({ type: "CHECKED.TOGGLE", checked, isTrusted: false });
    },
    getRootProps() {
      return normalize.label({
        ...parts3.root.attrs,
        ...dataAttrs,
        dir: prop("dir"),
        id: getRootId(scope),
        htmlFor: getHiddenInputId(scope),
        onPointerMove() {
          if (disabled) return;
          send({ type: "CONTEXT.SET", context: { hovered: true } });
        },
        onPointerLeave() {
          if (disabled) return;
          send({ type: "CONTEXT.SET", context: { hovered: false } });
        },
        onClick(event) {
          if (disabled) return;
          const target = getEventTarget(event);
          if (target === getHiddenInputEl(scope)) {
            event.stopPropagation();
          }
          if (isSafari()) {
            getHiddenInputEl(scope)?.focus();
          }
        }
      });
    },
    getLabelProps() {
      return normalize.element({
        ...parts3.label.attrs,
        ...dataAttrs,
        dir: prop("dir"),
        id: getLabelId(scope)
      });
    },
    getThumbProps() {
      return normalize.element({
        ...parts3.thumb.attrs,
        ...dataAttrs,
        dir: prop("dir"),
        id: getThumbId(scope),
        "aria-hidden": true
      });
    },
    getControlProps() {
      return normalize.element({
        ...parts3.control.attrs,
        ...dataAttrs,
        dir: prop("dir"),
        id: getControlId(scope),
        "aria-hidden": true
      });
    },
    getHiddenInputProps() {
      return normalize.input({
        id: getHiddenInputId(scope),
        type: "checkbox",
        required: prop("required"),
        defaultChecked: checked,
        disabled,
        "aria-labelledby": getLabelId(scope),
        "aria-invalid": prop("invalid"),
        name: prop("name"),
        form: prop("form"),
        value: prop("value"),
        style: visuallyHiddenStyle,
        onFocus() {
          const focusVisible2 = isFocusVisible();
          send({ type: "CONTEXT.SET", context: { focused: true, focusVisible: focusVisible2 } });
        },
        onBlur() {
          send({ type: "CONTEXT.SET", context: { focused: false, focusVisible: false } });
        },
        onClick(event) {
          if (readOnly) {
            event.preventDefault();
            return;
          }
          const checked2 = event.currentTarget.checked;
          send({ type: "CHECKED.SET", checked: checked2, isTrusted: true });
        }
      });
    }
  };
}

// node_modules/@zag-js/switch/dist/switch.machine.mjs
var { not } = createGuards();
var machine = createMachine({
  props({ props: props2 }) {
    return {
      defaultChecked: false,
      label: "switch",
      value: "on",
      ...props2
    };
  },
  initialState() {
    return "ready";
  },
  context({ prop, bindable }) {
    return {
      checked: bindable(() => ({
        defaultValue: prop("defaultChecked"),
        value: prop("checked"),
        onChange(value) {
          prop("onCheckedChange")?.({ checked: value });
        }
      })),
      fieldsetDisabled: bindable(() => ({
        defaultValue: false
      })),
      focusVisible: bindable(() => ({
        defaultValue: false
      })),
      active: bindable(() => ({
        defaultValue: false
      })),
      focused: bindable(() => ({
        defaultValue: false
      })),
      hovered: bindable(() => ({
        defaultValue: false
      }))
    };
  },
  computed: {
    isDisabled: ({ context, prop }) => prop("disabled") || context.get("fieldsetDisabled")
  },
  watch({ track, prop, context, action }) {
    track([() => prop("disabled")], () => {
      action(["removeFocusIfNeeded"]);
    });
    track([() => context.get("checked")], () => {
      action(["syncInputElement"]);
    });
  },
  effects: ["trackFormControlState", "trackPressEvent", "trackFocusVisible"],
  on: {
    "CHECKED.TOGGLE": [
      {
        guard: not("isTrusted"),
        actions: ["toggleChecked", "dispatchChangeEvent"]
      },
      {
        actions: ["toggleChecked"]
      }
    ],
    "CHECKED.SET": [
      {
        guard: not("isTrusted"),
        actions: ["setChecked", "dispatchChangeEvent"]
      },
      {
        actions: ["setChecked"]
      }
    ],
    "CONTEXT.SET": {
      actions: ["setContext"]
    }
  },
  states: {
    ready: {}
  },
  implementations: {
    guards: {
      isTrusted: ({ event }) => !!event.isTrusted
    },
    effects: {
      trackPressEvent({ computed, scope, context }) {
        if (computed("isDisabled")) return;
        return trackPress({
          pointerNode: getRootEl(scope),
          keyboardNode: getHiddenInputEl(scope),
          isValidKey: (event) => event.key === " ",
          onPress: () => context.set("active", false),
          onPressStart: () => context.set("active", true),
          onPressEnd: () => context.set("active", false)
        });
      },
      trackFocusVisible({ computed, scope }) {
        if (computed("isDisabled")) return;
        return trackFocusVisible({ root: scope.getRootNode() });
      },
      trackFormControlState({ context, send, scope }) {
        return trackFormControl(getHiddenInputEl(scope), {
          onFieldsetDisabledChange(disabled) {
            context.set("fieldsetDisabled", disabled);
          },
          onFormReset() {
            const checked = context.initial("checked");
            send({ type: "CHECKED.SET", checked: !!checked, src: "form-reset" });
          }
        });
      }
    },
    actions: {
      setContext({ context, event }) {
        for (const key in event.context) {
          context.set(key, event.context[key]);
        }
      },
      syncInputElement({ context, scope }) {
        const inputEl = getHiddenInputEl(scope);
        if (!inputEl) return;
        setElementChecked(inputEl, !!context.get("checked"));
      },
      removeFocusIfNeeded({ context, prop }) {
        if (prop("disabled")) {
          context.set("focused", false);
        }
      },
      setChecked({ context, event }) {
        context.set("checked", event.checked);
      },
      toggleChecked({ context }) {
        context.set("checked", !context.get("checked"));
      },
      dispatchChangeEvent({ context, scope }) {
        queueMicrotask(() => {
          const inputEl = getHiddenInputEl(scope);
          dispatchInputCheckedEvent(inputEl, { checked: context.get("checked") });
        });
      }
    }
  }
});

// node_modules/@zag-js/switch/dist/switch.props.mjs
var props = createProps()([
  "checked",
  "defaultChecked",
  "dir",
  "disabled",
  "form",
  "getRootNode",
  "id",
  "ids",
  "invalid",
  "label",
  "name",
  "onCheckedChange",
  "readOnly",
  "required",
  "value"
]);
var splitProps2 = createSplitProps2(props);

// node_modules/@ark-ui/solid/dist/chunk/G5CVQ36U.js
var [SwitchProvider, useSwitchContext] = createContext({
  hookName: "useSwitchContext",
  providerName: "<SwitchProvider />"
});
var SwitchContext = (props2) => props2.children(useSwitchContext());
var SwitchControl = (props2) => {
  const api = useSwitchContext();
  const mergedProps = mergeProps2(() => api().getControlProps(), props2);
  return createComponent(ark.span, mergedProps);
};
var SwitchHiddenInput = (props2) => {
  const api = useSwitchContext();
  const mergedProps = mergeProps2(() => api().getHiddenInputProps(), props2);
  const field = useFieldContext();
  return createComponent(ark.input, mergeProps({
    get ["aria-describedby"]() {
      return field?.().ariaDescribedby;
    }
  }, mergedProps));
};
var SwitchLabel = (props2) => {
  const api = useSwitchContext();
  const mergedProps = mergeProps2(() => api().getLabelProps(), props2);
  return createComponent(ark.span, mergedProps);
};
var useSwitch = (props2) => {
  const id = createUniqueId();
  const locale = useLocaleContext();
  const environment = useEnvironmentContext();
  const field = useFieldContext();
  const machineProps = createMemo(() => ({
    id,
    ids: {
      label: field?.().ids.label,
      hiddenInput: field?.().ids.control
    },
    disabled: field?.().disabled,
    readOnly: field?.().readOnly,
    invalid: field?.().invalid,
    required: field?.().required,
    dir: locale().dir,
    getRootNode: environment().getRootNode,
    ...runIfFn(props2)
  }));
  const service = useMachine(machine, machineProps);
  return createMemo(() => connect(service, normalizeProps));
};
var SwitchRoot = (props2) => {
  const [switchProps, localProps] = createSplitProps()(props2, ["checked", "defaultChecked", "disabled", "form", "id", "ids", "invalid", "label", "name", "onCheckedChange", "readOnly", "required", "value"]);
  const api = useSwitch(switchProps);
  const mergedProps = mergeProps2(() => api().getRootProps(), localProps);
  return createComponent(SwitchProvider, {
    value: api,
    get children() {
      return createComponent(ark.label, mergedProps);
    }
  });
};
var SwitchRootProvider = (props2) => {
  const [{
    value: api
  }, localProps] = createSplitProps()(props2, ["value"]);
  const mergedProps = mergeProps2(() => api().getRootProps(), localProps);
  return createComponent(SwitchProvider, {
    value: api,
    get children() {
      return createComponent(ark.label, mergedProps);
    }
  });
};
var SwitchThumb = (props2) => {
  const api = useSwitchContext();
  const mergedProps = mergeProps2(() => api().getThumbProps(), props2);
  return createComponent(ark.span, mergedProps);
};
var switch_exports = {};
__export(switch_exports, {
  Context: () => SwitchContext,
  Control: () => SwitchControl,
  HiddenInput: () => SwitchHiddenInput,
  Label: () => SwitchLabel,
  Root: () => SwitchRoot,
  RootProvider: () => SwitchRootProvider,
  Thumb: () => SwitchThumb
});
export {
  switch_exports as Switch,
  SwitchContext,
  SwitchControl,
  SwitchHiddenInput,
  SwitchLabel,
  SwitchRoot,
  SwitchRootProvider,
  SwitchThumb,
  anatomy as switchAnatomy,
  useSwitch,
  useSwitchContext
};
//# sourceMappingURL=@ark-ui_solid_switch.js.map
