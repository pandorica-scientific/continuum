/* @ds-bundle: {"format":4,"namespace":"ContinuumDesignSystem_bfc9d5","components":[{"name":"ActionError","sourcePath":"components/core/ActionError.jsx"},{"name":"BrandMark","sourcePath":"components/core/BrandMark.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/Button.jsx"},{"name":"Eyebrow","sourcePath":"components/core/Eyebrow.jsx"},{"name":"Field","sourcePath":"components/core/Field.jsx"},{"name":"Input","sourcePath":"components/core/Field.jsx"},{"name":"Select","sourcePath":"components/core/Field.jsx"},{"name":"Checkbox","sourcePath":"components/core/Field.jsx"},{"name":"ICONS","sourcePath":"components/core/Icon.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"InfoHint","sourcePath":"components/core/InfoHint.jsx"},{"name":"ListPager","sourcePath":"components/core/ListPager.jsx"},{"name":"MetricTile","sourcePath":"components/core/MetricTile.jsx"},{"name":"Modal","sourcePath":"components/core/Modal.jsx"},{"name":"PersonTag","sourcePath":"components/core/PersonTag.jsx"},{"name":"Pill","sourcePath":"components/core/Pill.jsx"},{"name":"Segmented","sourcePath":"components/core/Segmented.jsx"},{"name":"UploadDropzone","sourcePath":"components/core/UploadDropzone.jsx"},{"name":"AccountRow","sourcePath":"components/data/AccountRow.jsx"},{"name":"BriefingCard","sourcePath":"components/data/BriefingCard.jsx"},{"name":"DocumentsCard","sourcePath":"components/data/DocumentsCard.jsx"},{"name":"TransactionRow","sourcePath":"components/data/TransactionRow.jsx"},{"name":"Panel","sourcePath":"components/shell/Panel.jsx"},{"name":"QUICK_ADDS","sourcePath":"components/shell/QuickAdd.jsx"},{"name":"QuickAdd","sourcePath":"components/shell/QuickAdd.jsx"},{"name":"RateBanner","sourcePath":"components/shell/RateBanner.jsx"},{"name":"ScreenHeader","sourcePath":"components/shell/ScreenHeader.jsx"},{"name":"AREAS","sourcePath":"components/shell/Sidebar.jsx"},{"name":"Sidebar","sourcePath":"components/shell/Sidebar.jsx"}],"sourceHashes":{"assets/icons.js":"718d1c39a7b8","components/core/ActionError.jsx":"60eb284a2317","components/core/BrandMark.jsx":"bbfc7fc082de","components/core/Button.jsx":"6688404791e7","components/core/Eyebrow.jsx":"1a019151ee75","components/core/Field.jsx":"c655393fc2dd","components/core/Icon.jsx":"441e5e9c55cb","components/core/InfoHint.jsx":"b5cf62634343","components/core/ListPager.jsx":"02e2b9da2195","components/core/MetricTile.jsx":"156177d105a8","components/core/Modal.jsx":"eeefb614f20a","components/core/PersonTag.jsx":"408b5261dd6f","components/core/Pill.jsx":"51934a85be49","components/core/Segmented.jsx":"cb146e3ae7b5","components/core/UploadDropzone.jsx":"1f79f7a0fe98","components/data/AccountRow.jsx":"ed0c937064b3","components/data/BriefingCard.jsx":"bf339332ddc6","components/data/DocumentsCard.jsx":"2014a97a2e1a","components/data/TransactionRow.jsx":"369ee6562529","components/shell/Panel.jsx":"661a0ce20013","components/shell/QuickAdd.jsx":"eaeaf1ec441d","components/shell/RateBanner.jsx":"0fef82f07256","components/shell/ScreenHeader.jsx":"312199a28ee2","components/shell/Sidebar.jsx":"85d2f7c6fc49","ui_kits/continuum-app/App.jsx":"1dd44c528b7d","ui_kits/continuum-app/Screens.jsx":"09a6ab63527a","ui_kits/continuum-app/data.js":"7a33cdf64f9d"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ContinuumDesignSystem_bfc9d5 = window.ContinuumDesignSystem_bfc9d5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// assets/icons.js
try { (() => {
// Continuum icon set — copied verbatim from src/lib/icons.ts. 24 viewBox, fill none, currentColor stroke 1.7, round caps/joins.
// Loaded as a plain script; exposes window.CONTINUUM_ICONS.
window.CONTINUUM_ICONS = {
  compass: [{
    circle: [12, 12, 9]
  }, {
    path: 'M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z'
  }],
  flow: [{
    path: 'M3 12h5l4-7h9'
  }, {
    path: 'M8 12l4 7h9'
  }, {
    path: 'M18 2.5 21 5l-3 2.5'
  }],
  bank: [{
    path: 'M3 10 12 4.5 21 10'
  }, {
    line: [5.5, 10.5, 5.5, 18]
  }, {
    line: [12, 10.5, 12, 18]
  }, {
    line: [18.5, 10.5, 18.5, 18]
  }, {
    line: [3, 20.5, 21, 20.5]
  }],
  ledger: [{
    path: 'M5 4.8A1.8 1.8 0 0 1 6.8 3H19v18H6.8A1.8 1.8 0 0 1 5 19.2z'
  }, {
    line: [9, 3, 9, 21]
  }],
  receipt: [{
    path: 'M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z'
  }, {
    line: [9, 8, 15, 8]
  }, {
    line: [9, 12, 15, 12]
  }],
  inbox: [{
    line: [12, 3, 12, 13]
  }, {
    path: 'M8 9.5l4 4 4-4'
  }, {
    path: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
  }],
  sliders: [{
    line: [3.5, 8, 20.5, 8]
  }, {
    circle: [9, 8, 2.2]
  }, {
    line: [3.5, 16, 20.5, 16]
  }, {
    circle: [15, 16, 2.2]
  }],
  tag: [{
    path: 'M3 12.6V4.4A1.4 1.4 0 0 1 4.4 3h8.2L21 11.4 12.6 21z'
  }, {
    circle: [7.6, 7.6, 1.5]
  }],
  buildings: [{
    path: 'M4 21V8.5L11 5v16'
  }, {
    path: 'M11 21V11l8-2.5V21'
  }, {
    line: [3, 21, 21, 21]
  }, {
    line: [7, 10.5, 7.8, 10.5]
  }, {
    line: [14.5, 14, 15.3, 14]
  }],
  chart: [{
    path: 'M4 16l4.5-4.5 3 3L18 8'
  }, {
    path: 'M14.5 8H18v3.5'
  }, {
    path: 'M3 3v17h18'
  }],
  card: [{
    rect: [2.5, 5, 19, 14, 2.5]
  }, {
    line: [2.5, 10, 21.5, 10]
  }, {
    line: [6, 14.5, 10, 14.5]
  }],
  wallet: [{
    rect: [2.5, 6, 19, 13, 2.5]
  }, {
    path: 'M2.5 9.5h12A1.5 1.5 0 0 1 16 11v3a1.5 1.5 0 0 1-1.5 1.5h-12'
  }, {
    circle: [17.5, 12.5, 1.1]
  }],
  target: [{
    circle: [12, 12, 9]
  }, {
    circle: [12, 12, 5]
  }, {
    circle: [12, 12, 1.4]
  }],
  house: [{
    path: 'M3 10.6 12 3.5l9 7.1'
  }, {
    path: 'M5.6 9.6V20.5h12.8V9.6'
  }],
  calendar: [{
    rect: [3, 5, 18, 16, 2.5]
  }, {
    line: [3, 10, 21, 10]
  }, {
    line: [8, 3, 8, 7]
  }, {
    line: [16, 3, 16, 7]
  }],
  folders: [{
    path: 'M3 7.6A1.6 1.6 0 0 1 4.6 6H9l2.2 2.6h8.2A1.6 1.6 0 0 1 21 10.2v8.2A1.6 1.6 0 0 1 19.4 20H4.6A1.6 1.6 0 0 1 3 18.4z'
  }],
  info: [{
    circle: [12, 12, 9]
  }, {
    line: [12, 11, 12, 16.5]
  }, {
    line: [12, 7.8, 12, 8.2]
  }],
  people: [{
    circle: [9.2, 8.4, 3.1]
  }, {
    path: 'M3.6 19.4a5.6 5.6 0 0 1 11.2 0'
  }, {
    path: 'M15.6 5.7a3.1 3.1 0 0 1 0 5.4'
  }, {
    path: 'M17.2 13.6a5.6 5.6 0 0 1 3.2 5.8'
  }],
  gear: [{
    circle: [12, 12, 2.4]
  }, {
    circle: [12, 12, 5.6]
  }, {
    line: [17.6, 12, 20.4, 12]
  }, {
    line: [15.96, 15.96, 17.94, 17.94]
  }, {
    line: [12, 17.6, 12, 20.4]
  }, {
    line: [8.04, 15.96, 6.06, 17.94]
  }, {
    line: [6.4, 12, 3.6, 12]
  }, {
    line: [8.04, 8.04, 6.06, 6.06]
  }, {
    line: [12, 6.4, 12, 3.6]
  }, {
    line: [15.96, 8.04, 17.94, 6.06]
  }],
  plus: [{
    line: [12, 5.5, 12, 18.5]
  }, {
    line: [5.5, 12, 18.5, 12]
  }],
  clock: [{
    circle: [12, 12, 8.5]
  }, {
    path: 'M12 7.2V12l3.2 2'
  }],
  camera: [{
    path: 'M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.3-2h8l1.3 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z'
  }, {
    circle: [12, 13, 3.4]
  }],
  bolt: [{
    path: 'M13 2.5 5.5 13.5H11l-1 8 8.5-11H13z'
  }],
  scan: [{
    path: 'M3 8V5.5A1.5 1.5 0 0 1 4.5 4H7'
  }, {
    path: 'M17 4h2.5A1.5 1.5 0 0 1 21 5.5V8'
  }, {
    path: 'M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H17'
  }, {
    path: 'M7 20H4.5A1.5 1.5 0 0 1 3 18.5V16'
  }, {
    line: [3, 12, 21, 12]
  }],
  rotate: [{
    path: 'M20 12a8 8 0 1 1-2.6-5.9'
  }, {
    path: 'M20 3.5V8h-4.5'
  }],
  grip: [{
    circle: [9, 6, 1.1]
  }, {
    circle: [15, 6, 1.1]
  }, {
    circle: [9, 12, 1.1]
  }, {
    circle: [15, 12, 1.1]
  }, {
    circle: [9, 18, 1.1]
  }, {
    circle: [15, 18, 1.1]
  }],
  check: [{
    path: 'M4.5 12.5 9.5 17.5 19.5 6.5'
  }],
  lock: [{
    rect: [5, 10.5, 14, 10, 2]
  }, {
    path: 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3'
  }],
  pencil: [{
    path: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z'
  }, {
    path: 'M13.5 6.5l3 3'
  }],
  search: [{
    circle: [11, 11, 6.5]
  }, {
    line: [15.8, 15.8, 20, 20]
  }],
  arrowUp: [{
    line: [12, 20, 12, 4]
  }, {
    path: 'M6 10l6-6 6 6'
  }],
  arrowDown: [{
    line: [12, 4, 12, 20]
  }, {
    path: 'M18 14l-6 6-6-6'
  }],
  chevronLeft: [{
    path: 'M15 5l-7 7 7 7'
  }],
  chevronRight: [{
    path: 'M9 5l7 7-7 7'
  }],
  bell: [{
    path: 'M6.5 10a5.5 5.5 0 0 1 11 0c0 4.3 1.1 5.7 1.9 6.5H4.6c.8-.8 1.9-2.2 1.9-6.5z'
  }, {
    path: 'M10 19.4a2.2 2.2 0 0 0 4 0'
  }],
  layers: [{
    path: 'M12 3.5 21 8l-9 4.5L3 8z'
  }, {
    path: 'M3 12l9 4.5L21 12'
  }, {
    path: 'M3 16l9 4.5L21 16'
  }],
  coins: [{
    path: 'M4 7.5a6.5 2.6 0 1 0 13 0a6.5 2.6 0 1 0-13 0'
  }, {
    path: 'M4 7.5v2.4a6.5 2.6 0 0 0 13 0V7.5'
  }, {
    path: 'M7 14a6.5 2.6 0 1 0 13 0a6.5 2.6 0 1 0-13 0'
  }, {
    path: 'M7 14v2.4a6.5 2.6 0 0 0 13 0V14'
  }],
  bars: [{
    line: [3.5, 20.5, 20.5, 20.5]
  }, {
    line: [7.5, 20.5, 7.5, 14]
  }, {
    line: [12, 20.5, 12, 9]
  }, {
    line: [16.5, 20.5, 16.5, 5.5]
  }],
  trend: [{
    path: 'M3 16.5 9 10.5l3.5 3.5L21 5.5'
  }, {
    path: 'M15 5.5h6v6'
  }],
  key: [{
    circle: [7.6, 16.4, 3.9]
  }, {
    line: [10.4, 13.6, 20.5, 3.5]
  }, {
    line: [17.6, 6.4, 19.6, 8.4]
  }, {
    line: [14.8, 9.2, 16.8, 11.2]
  }],
  alert: [{
    path: 'M12 4.2 21 19.8H3z'
  }, {
    line: [12, 10.5, 12, 15]
  }, {
    line: [12, 17.6, 12, 17.8]
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/icons.js", error: String((e && e.message) || e) }); }

// components/core/ActionError.jsx
try { (() => {
function ActionError({
  message,
  style
}) {
  if (!message) return null;
  return /*#__PURE__*/React.createElement("p", {
    role: "alert",
    style: {
      margin: 0,
      border: '1px solid var(--red)',
      background: 'var(--red-tint)',
      color: 'var(--red)',
      borderRadius: 'var(--radius-lg)',
      padding: '9px 12px',
      fontSize: 'var(--text-md)',
      ...style
    }
  }, message);
}
Object.assign(__ds_scope, { ActionError });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ActionError.jsx", error: String((e && e.message) || e) }); }

// components/core/BrandMark.jsx
try { (() => {
function BrandMark({
  size = 22,
  withWordmark = false,
  style
}) {
  const mark = /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 56 56",
    style: {
      width: size,
      height: size,
      flex: '0 0 auto',
      display: 'block',
      color: 'var(--brand)'
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("g", {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3.2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 18 A10 10 0 0 1 18 38"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 10 A18 18 0 0 1 18 46",
    opacity: "0.62"
  }), size >= 16 && /*#__PURE__*/React.createElement("path", {
    d: "M18 3 A25 25 0 0 1 18 53",
    opacity: "0.34"
  })), /*#__PURE__*/React.createElement("circle", {
    cx: "18",
    cy: "28",
    r: "3.6",
    fill: "currentColor"
  }));
  if (!withWordmark) return mark;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 9,
      ...style
    }
  }, mark, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xl)',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: 'var(--fg1)'
    }
  }, "Continuum"));
}
Object.assign(__ds_scope, { BrandMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/BrandMark.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  variant = 'default',
  children,
  disabled,
  onClick,
  type = 'button',
  style,
  href
}) {
  const [state, setState] = React.useState('idle');
  const primary = variant === 'primary';
  const s = {
    border: '1px solid ' + (primary ? 'var(--blue)' : 'var(--bd2)'),
    background: primary ? 'var(--blue)' : state === 'active' ? 'var(--card3)' : state === 'hover' ? 'var(--card2)' : 'var(--card)',
    color: primary ? 'var(--fg-inverse)' : 'var(--fg1)',
    opacity: disabled ? 0.45 : primary && state === 'active' ? 0.78 : primary && state === 'hover' ? 0.9 : 1,
    borderRadius: 8,
    padding: '7px 13px',
    fontSize: 'var(--text-md)',
    fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    minHeight: 'var(--control-h)',
    lineHeight: 1.35,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-3)',
    textDecoration: 'none',
    transform: state === 'active' && !disabled ? 'translateY(1px)' : 'none',
    transition: 'background-color 90ms ease-out, transform 90ms ease-out',
    ...style
  };
  const h = {
    onMouseEnter: () => setState('hover'),
    onMouseLeave: () => setState('idle'),
    onMouseDown: () => setState('active'),
    onMouseUp: () => setState('hover')
  };
  if (href) return /*#__PURE__*/React.createElement("a", _extends({
    href: href,
    style: s
  }, h, {
    onClick: onClick
  }), children);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    style: s
  }, h, {
    onClick: onClick
  }), children);
}
function IconButton({
  children,
  label,
  expanded,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const on = hover || expanded;
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": label,
    "aria-expanded": expanded,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: 'none',
      border: '1px solid ' + (on ? 'var(--blue)' : 'var(--bd)'),
      borderRadius: 'var(--radius-md)',
      color: on ? 'var(--fg1)' : 'var(--fg3)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      padding: '5px 8px',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Button, IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const control = {
  border: '1px solid var(--bd2)',
  background: 'var(--card)',
  color: 'var(--fg1)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4) 11px',
  fontSize: 'var(--text-md)',
  fontFamily: 'inherit',
  lineHeight: 1.35,
  minHeight: 'var(--control-h)',
  width: '100%',
  boxSizing: 'border-box'
};
function Field({
  label,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)',
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", null, label), children);
}
function Input(props) {
  return /*#__PURE__*/React.createElement("input", _extends({}, props, {
    style: {
      ...control,
      ...props.style
    }
  }));
}
function Select({
  options = [],
  ...props
}) {
  return /*#__PURE__*/React.createElement("select", _extends({}, props, {
    style: {
      ...control,
      ...props.style
    }
  }), options.map(o => typeof o === 'string' ? /*#__PURE__*/React.createElement("option", {
    key: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)));
}
function Checkbox({
  label,
  ...props
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      fontSize: 'var(--text-md)',
      color: 'var(--fg2)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox"
  }, props, {
    style: {
      accentColor: 'var(--blue)',
      margin: 0
    }
  })), label);
}
Object.assign(__ds_scope, { Field, Input, Select, Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Field.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
// Continuum icon set, copied from src/lib/icons.ts. Same geometry as the product's Icon.svelte.
const ICONS = {
  compass: [{
    circle: [12, 12, 9]
  }, {
    path: 'M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z'
  }],
  flow: [{
    path: 'M3 12h5l4-7h9'
  }, {
    path: 'M8 12l4 7h9'
  }, {
    path: 'M18 2.5 21 5l-3 2.5'
  }],
  bank: [{
    path: 'M3 10 12 4.5 21 10'
  }, {
    line: [5.5, 10.5, 5.5, 18]
  }, {
    line: [12, 10.5, 12, 18]
  }, {
    line: [18.5, 10.5, 18.5, 18]
  }, {
    line: [3, 20.5, 21, 20.5]
  }],
  ledger: [{
    path: 'M5 4.8A1.8 1.8 0 0 1 6.8 3H19v18H6.8A1.8 1.8 0 0 1 5 19.2z'
  }, {
    line: [9, 3, 9, 21]
  }],
  receipt: [{
    path: 'M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z'
  }, {
    line: [9, 8, 15, 8]
  }, {
    line: [9, 12, 15, 12]
  }],
  inbox: [{
    line: [12, 3, 12, 13]
  }, {
    path: 'M8 9.5l4 4 4-4'
  }, {
    path: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
  }],
  sliders: [{
    line: [3.5, 8, 20.5, 8]
  }, {
    circle: [9, 8, 2.2]
  }, {
    line: [3.5, 16, 20.5, 16]
  }, {
    circle: [15, 16, 2.2]
  }],
  tag: [{
    path: 'M3 12.6V4.4A1.4 1.4 0 0 1 4.4 3h8.2L21 11.4 12.6 21z'
  }, {
    circle: [7.6, 7.6, 1.5]
  }],
  buildings: [{
    path: 'M4 21V8.5L11 5v16'
  }, {
    path: 'M11 21V11l8-2.5V21'
  }, {
    line: [3, 21, 21, 21]
  }, {
    line: [7, 10.5, 7.8, 10.5]
  }, {
    line: [14.5, 14, 15.3, 14]
  }],
  chart: [{
    path: 'M4 16l4.5-4.5 3 3L18 8'
  }, {
    path: 'M14.5 8H18v3.5'
  }, {
    path: 'M3 3v17h18'
  }],
  card: [{
    rect: [2.5, 5, 19, 14, 2.5]
  }, {
    line: [2.5, 10, 21.5, 10]
  }, {
    line: [6, 14.5, 10, 14.5]
  }],
  wallet: [{
    rect: [2.5, 6, 19, 13, 2.5]
  }, {
    path: 'M2.5 9.5h12A1.5 1.5 0 0 1 16 11v3a1.5 1.5 0 0 1-1.5 1.5h-12'
  }, {
    circle: [17.5, 12.5, 1.1]
  }],
  target: [{
    circle: [12, 12, 9]
  }, {
    circle: [12, 12, 5]
  }, {
    circle: [12, 12, 1.4]
  }],
  house: [{
    path: 'M3 10.6 12 3.5l9 7.1'
  }, {
    path: 'M5.6 9.6V20.5h12.8V9.6'
  }],
  calendar: [{
    rect: [3, 5, 18, 16, 2.5]
  }, {
    line: [3, 10, 21, 10]
  }, {
    line: [8, 3, 8, 7]
  }, {
    line: [16, 3, 16, 7]
  }],
  folders: [{
    path: 'M3 7.6A1.6 1.6 0 0 1 4.6 6H9l2.2 2.6h8.2A1.6 1.6 0 0 1 21 10.2v8.2A1.6 1.6 0 0 1 19.4 20H4.6A1.6 1.6 0 0 1 3 18.4z'
  }],
  info: [{
    circle: [12, 12, 9]
  }, {
    line: [12, 11, 12, 16.5]
  }, {
    line: [12, 7.8, 12, 8.2]
  }],
  people: [{
    circle: [9.2, 8.4, 3.1]
  }, {
    path: 'M3.6 19.4a5.6 5.6 0 0 1 11.2 0'
  }, {
    path: 'M15.6 5.7a3.1 3.1 0 0 1 0 5.4'
  }, {
    path: 'M17.2 13.6a5.6 5.6 0 0 1 3.2 5.8'
  }],
  gear: [{
    circle: [12, 12, 2.4]
  }, {
    circle: [12, 12, 5.6]
  }, {
    line: [17.6, 12, 20.4, 12]
  }, {
    line: [15.96, 15.96, 17.94, 17.94]
  }, {
    line: [12, 17.6, 12, 20.4]
  }, {
    line: [8.04, 15.96, 6.06, 17.94]
  }, {
    line: [6.4, 12, 3.6, 12]
  }, {
    line: [8.04, 8.04, 6.06, 6.06]
  }, {
    line: [12, 6.4, 12, 3.6]
  }, {
    line: [15.96, 8.04, 17.94, 6.06]
  }],
  plus: [{
    line: [12, 5.5, 12, 18.5]
  }, {
    line: [5.5, 12, 18.5, 12]
  }],
  clock: [{
    circle: [12, 12, 8.5]
  }, {
    path: 'M12 7.2V12l3.2 2'
  }],
  camera: [{
    path: 'M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.3-2h8l1.3 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z'
  }, {
    circle: [12, 13, 3.4]
  }],
  bolt: [{
    path: 'M13 2.5 5.5 13.5H11l-1 8 8.5-11H13z'
  }],
  scan: [{
    path: 'M3 8V5.5A1.5 1.5 0 0 1 4.5 4H7'
  }, {
    path: 'M17 4h2.5A1.5 1.5 0 0 1 21 5.5V8'
  }, {
    path: 'M21 16v2.5a1.5 1.5 0 0 1-1.5 1.5H17'
  }, {
    path: 'M7 20H4.5A1.5 1.5 0 0 1 3 18.5V16'
  }, {
    line: [3, 12, 21, 12]
  }],
  rotate: [{
    path: 'M20 12a8 8 0 1 1-2.6-5.9'
  }, {
    path: 'M20 3.5V8h-4.5'
  }],
  grip: [{
    circle: [9, 6, 1.1]
  }, {
    circle: [15, 6, 1.1]
  }, {
    circle: [9, 12, 1.1]
  }, {
    circle: [15, 12, 1.1]
  }, {
    circle: [9, 18, 1.1]
  }, {
    circle: [15, 18, 1.1]
  }],
  check: [{
    path: 'M4.5 12.5 9.5 17.5 19.5 6.5'
  }],
  lock: [{
    rect: [5, 10.5, 14, 10, 2]
  }, {
    path: 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3'
  }],
  pencil: [{
    path: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z'
  }, {
    path: 'M13.5 6.5l3 3'
  }],
  search: [{
    circle: [11, 11, 6.5]
  }, {
    line: [15.8, 15.8, 20, 20]
  }],
  arrowUp: [{
    line: [12, 20, 12, 4]
  }, {
    path: 'M6 10l6-6 6 6'
  }],
  arrowDown: [{
    line: [12, 4, 12, 20]
  }, {
    path: 'M18 14l-6 6-6-6'
  }],
  chevronLeft: [{
    path: 'M15 5l-7 7 7 7'
  }],
  chevronRight: [{
    path: 'M9 5l7 7-7 7'
  }],
  bell: [{
    path: 'M6.5 10a5.5 5.5 0 0 1 11 0c0 4.3 1.1 5.7 1.9 6.5H4.6c.8-.8 1.9-2.2 1.9-6.5z'
  }, {
    path: 'M10 19.4a2.2 2.2 0 0 0 4 0'
  }],
  layers: [{
    path: 'M12 3.5 21 8l-9 4.5L3 8z'
  }, {
    path: 'M3 12l9 4.5L21 12'
  }, {
    path: 'M3 16l9 4.5L21 16'
  }],
  coins: [{
    path: 'M4 7.5a6.5 2.6 0 1 0 13 0a6.5 2.6 0 1 0-13 0'
  }, {
    path: 'M4 7.5v2.4a6.5 2.6 0 0 0 13 0V7.5'
  }, {
    path: 'M7 14a6.5 2.6 0 1 0 13 0a6.5 2.6 0 1 0-13 0'
  }, {
    path: 'M7 14v2.4a6.5 2.6 0 0 0 13 0V14'
  }],
  bars: [{
    line: [3.5, 20.5, 20.5, 20.5]
  }, {
    line: [7.5, 20.5, 7.5, 14]
  }, {
    line: [12, 20.5, 12, 9]
  }, {
    line: [16.5, 20.5, 16.5, 5.5]
  }],
  trend: [{
    path: 'M3 16.5 9 10.5l3.5 3.5L21 5.5'
  }, {
    path: 'M15 5.5h6v6'
  }],
  key: [{
    circle: [7.6, 16.4, 3.9]
  }, {
    line: [10.4, 13.6, 20.5, 3.5]
  }, {
    line: [17.6, 6.4, 19.6, 8.4]
  }, {
    line: [14.8, 9.2, 16.8, 11.2]
  }],
  alert: [{
    path: 'M12 4.2 21 19.8H3z'
  }, {
    line: [12, 10.5, 12, 15]
  }, {
    line: [12, 17.6, 12, 17.8]
  }]
};
function Icon({
  name,
  size = 19,
  label,
  style
}) {
  const parts = ICONS[name] || [];
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: label ? 'img' : 'presentation',
    "aria-label": label,
    "aria-hidden": label ? undefined : 'true',
    style: {
      display: 'block',
      flex: 'none',
      ...style
    }
  }, parts.map((p, i) => p.path ? /*#__PURE__*/React.createElement("path", {
    key: i,
    d: p.path
  }) : p.circle ? /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p.circle[0],
    cy: p.circle[1],
    r: p.circle[2]
  }) : p.rect ? /*#__PURE__*/React.createElement("rect", {
    key: i,
    x: p.rect[0],
    y: p.rect[1],
    width: p.rect[2],
    height: p.rect[3],
    rx: p.rect[4]
  }) : /*#__PURE__*/React.createElement("line", {
    key: i,
    x1: p.line[0],
    y1: p.line[1],
    x2: p.line[2],
    y2: p.line[3]
  })));
}
Object.assign(__ds_scope, { ICONS, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Eyebrow.jsx
try { (() => {
function Eyebrow({
  emoji,
  icon,
  label,
  caption,
  right,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 14,
      flexWrap: 'wrap',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 'var(--text-xs)',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--fg3)',
      minWidth: 0
    }
  }, icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  }) : emoji ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      letterSpacing: 0
    }
  }, emoji) : null, label), right ? right : caption ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-md)',
      color: 'var(--fg3)'
    }
  }, caption) : null);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/core/InfoHint.jsx
try { (() => {
function InfoHint({
  label,
  children,
  side = 'left'
}) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const visible = open || hover;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      verticalAlign: 'middle'
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": label,
    "aria-expanded": open,
    onClick: () => setOpen(!open),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      padding: 0,
      border: 'none',
      background: 'none',
      color: visible ? 'var(--blue)' : 'var(--fg3)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "info",
    size: 18
  })), visible && /*#__PURE__*/React.createElement("span", {
    role: "note",
    style: {
      position: 'absolute',
      top: 22,
      [side === 'right' ? 'right' : 'left']: -4,
      zIndex: 20,
      width: 'max-content',
      maxWidth: 340,
      padding: 'var(--space-5) var(--space-6)',
      border: '1px solid var(--bd2)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg2)',
      color: 'var(--fg1)',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.5,
      boxShadow: 'var(--shadow-float)',
      textAlign: 'left',
      whiteSpace: 'normal'
    }
  }, children));
}
Object.assign(__ds_scope, { InfoHint });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/InfoHint.jsx", error: String((e && e.message) || e) }); }

// components/core/ListPager.jsx
try { (() => {
function ListPager({
  page = 0,
  pages = 1,
  range,
  onChange,
  bare = false
}) {
  const [p, setP] = React.useState(page);
  const go = n => {
    setP(n);
    onChange && onChange(n);
  };
  const step = dis => ({
    background: 'none',
    border: '1px solid var(--bd)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--fg2)',
    cursor: dis ? 'default' : 'pointer',
    fontSize: 'var(--text-md)',
    lineHeight: 1,
    padding: 'var(--space-2) var(--space-5)',
    opacity: dis ? 0.35 : 1,
    fontFamily: 'inherit'
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: '10px var(--space-6)',
      borderTop: bare ? 0 : '1px solid var(--bd2)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: p === 0,
    "aria-label": "Previous page",
    onClick: () => go(Math.max(0, p - 1)),
    style: step(p === 0)
  }, "\u2039"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-3)',
      fontSize: 'var(--text-sm)',
      color: 'var(--fg2)',
      fontFamily: 'var(--font-mono)'
    }
  }, p + 1, " / ", pages, range && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)'
    }
  }, range)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: p >= pages - 1,
    "aria-label": "Next page",
    onClick: () => go(Math.min(pages - 1, p + 1)),
    style: step(p >= pages - 1)
  }, "\u203A"));
}
Object.assign(__ds_scope, { ListPager });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ListPager.jsx", error: String((e && e.message) || e) }); }

// components/core/MetricTile.jsx
try { (() => {
function MetricTile({
  label,
  value,
  unit,
  note,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--card)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-6) var(--space-7)',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      color: color || 'var(--fg1)'
    }
  }, value, unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)',
      marginLeft: 5
    }
  }, unit)), note && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)'
    }
  }, note));
}
Object.assign(__ds_scope, { MetricTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/MetricTile.jsx", error: String((e && e.message) || e) }); }

// components/core/Modal.jsx
try { (() => {
function Modal({
  title,
  onClose,
  children,
  titleAside,
  inline = false,
  width = 860
}) {
  const box = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
    style: {
      background: 'linear-gradient(var(--card), var(--card)), var(--bg)',
      border: '1px solid var(--bd2)',
      borderRadius: 14,
      padding: '18px 20px',
      width: 'min(' + width + 'px, 100%)',
      maxHeight: inline ? 'none' : 'calc(100vh - 40px)',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-7)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xl)',
      fontWeight: 600
    }
  }, title), titleAside, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Close",
    onClick: onClose,
    style: {
      marginLeft: 'auto',
      border: 0,
      background: 'transparent',
      color: 'var(--fg3)',
      fontSize: 'var(--text-lg)',
      cursor: 'pointer',
      padding: 4
    }
  }, "\u2715")), children);
  if (inline) return box;
  return /*#__PURE__*/React.createElement("div", {
    role: "presentation",
    onClick: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgb(0 0 0 / 0.55)',
      display: 'grid',
      placeItems: 'center',
      padding: 20,
      zIndex: 60,
      overflowY: 'auto'
    }
  }, box);
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Modal.jsx", error: String((e && e.message) || e) }); }

// components/core/PersonTag.jsx
try { (() => {
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function PersonTag({
  name,
  hue = '--series-health',
  compact = false
}) {
  const tag = 'var(' + hue + ')';
  return /*#__PURE__*/React.createElement("span", {
    title: compact ? name : undefined,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      border: '1px solid color-mix(in srgb, ' + tag + ' 45%, transparent)',
      background: 'color-mix(in srgb, ' + tag + ' 12%, transparent)',
      color: tag,
      borderRadius: 'var(--radius-xl)',
      padding: '1px 8px',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      lineHeight: 1.4,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: tag,
      flex: 'none'
    }
  }), compact ? initials(name) : name);
}
Object.assign(__ds_scope, { PersonTag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/PersonTag.jsx", error: String((e && e.message) || e) }); }

// components/core/Pill.jsx
try { (() => {
// Pill.svelte: the traffic-light pill. green/yellow/red mean state; blue/teal/purple carry a series; grey is neutral.
function Pill({
  hue = 'grey',
  children,
  style
}) {
  const color = hue === 'grey' ? 'var(--fg3)' : 'var(--' + hue + ')';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      border: '1px solid ' + color,
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-1) var(--space-5)',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      fontFamily: 'var(--font-mono)',
      color,
      background: 'var(--' + hue + '-tint)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Pill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Pill.jsx", error: String((e && e.message) || e) }); }

// components/core/Segmented.jsx
try { (() => {
function Segmented({
  options,
  value,
  onChange,
  style
}) {
  const [v, setV] = React.useState(value ?? options[0]?.value);
  React.useEffect(() => {
    if (value !== undefined) setV(value);
  }, [value]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: 'var(--space-3)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-md)',
      padding: 3,
      background: 'var(--card)',
      ...style
    }
  }, options.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    type: "button",
    onClick: () => {
      setV(o.value);
      onChange && onChange(o.value);
    },
    style: {
      border: 0,
      background: v === o.value ? 'var(--card3)' : 'transparent',
      color: v === o.value ? 'var(--fg1)' : 'var(--fg3)',
      borderRadius: 'var(--radius-sm)',
      padding: '6px 13px',
      fontSize: 'var(--text-sm)',
      fontFamily: 'inherit',
      cursor: 'pointer'
    }
  }, o.label)));
}
Object.assign(__ds_scope, { Segmented });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Segmented.jsx", error: String((e && e.message) || e) }); }

// components/core/UploadDropzone.jsx
try { (() => {
function UploadDropzone({
  idleText,
  busy = false,
  busyText = 'Uploading…',
  showCapture = false,
  onFiles,
  style
}) {
  const [drag, setDrag] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const cap = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    width: 30,
    height: 30,
    margin: '-4px -6px -4px 0',
    border: 0,
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--fg3)',
    cursor: 'pointer'
  };
  return /*#__PURE__*/React.createElement("div", {
    role: "button",
    tabIndex: 0,
    "aria-busy": busy,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onDragOver: e => {
      e.preventDefault();
      setDrag(true);
    },
    onDragLeave: () => setDrag(false),
    onDrop: e => {
      e.preventDefault();
      setDrag(false);
      onFiles && onFiles(e.dataTransfer.files);
    },
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      minHeight: 'var(--control-h)',
      padding: '7px 13px',
      border: '1.5px dashed ' + (drag ? 'var(--blue)' : 'var(--bd2)'),
      borderRadius: 'var(--radius-md)',
      fontSize: 'var(--text-md)',
      lineHeight: 1.35,
      color: drag || hover ? 'var(--fg1)' : 'var(--fg2)',
      background: drag ? 'var(--blue-wash)' : 'transparent',
      cursor: busy ? 'progress' : 'pointer',
      opacity: busy ? 0.75 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, busy ? busyText : idleText), showCapture && !busy && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Take a photo",
    style: cap
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "camera",
    size: 18
  })), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Scan a document",
    style: cap
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "scan",
    size: 18
  }))));
}
Object.assign(__ds_scope, { UploadDropzone });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/UploadDropzone.jsx", error: String((e && e.message) || e) }); }

// components/data/AccountRow.jsx
try { (() => {
function AccountRow({
  emoji = '🏦',
  name,
  numbers = [],
  meta,
  balance,
  baseEquivalent,
  first = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '26px minmax(0,1fr) auto',
      alignItems: 'center',
      gap: 'var(--space-6)',
      padding: '11px 0',
      borderTop: first ? 0 : '1px solid var(--bd)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xl)'
    }
  }, emoji), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-md)',
      color: 'var(--fg1)'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    "aria-label": 'Edit ' + name,
    style: {
      color: 'var(--fg3)',
      fontSize: 'var(--text-md)',
      lineHeight: 1,
      cursor: 'pointer'
    }
  }, "\u270E")), numbers.length > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)',
      overflowWrap: 'anywhere'
    }
  }, numbers.join(' · ')), meta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)'
    }
  }, meta)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      textAlign: 'right',
      fontFamily: 'var(--font-mono)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-md)',
      fontWeight: 600,
      color: 'var(--fg1)'
    }
  }, balance), baseEquivalent && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)'
    }
  }, baseEquivalent)));
}
Object.assign(__ds_scope, { AccountRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/AccountRow.jsx", error: String((e && e.message) || e) }); }

// components/data/BriefingCard.jsx
try { (() => {
function BriefingCard({
  kind,
  icon = 'bell',
  pill,
  hue = 'grey',
  title,
  body,
  style
}) {
  return /*#__PURE__*/React.createElement("article", {
    style: {
      background: 'var(--card)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 'var(--text-md)',
      color: 'var(--fg3)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16
  }), kind), pill && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Pill, {
    hue: hue
  }, pill))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-lg)',
      fontWeight: 500,
      color: 'var(--fg1)',
      lineHeight: 1.35
    }
  }, title), body && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-md)',
      color: 'var(--fg3)',
      lineHeight: 1.5
    }
  }, body));
}
Object.assign(__ds_scope, { BriefingCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/BriefingCard.jsx", error: String((e && e.message) || e) }); }

// components/data/DocumentsCard.jsx
try { (() => {
function DocumentsCard({
  heading = 'Documents',
  documents = [],
  bare = false,
  isAdmin = true,
  attachCandidates = [],
  addHref,
  emptyText = 'Nothing filed yet.'
}) {
  const tone = d => d.tone === 'past' ? 'var(--red)' : d.tone === 'soon' ? 'var(--yellow)' : 'var(--fg3)';
  const body = /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Eyebrow, {
    emoji: "\uD83D\uDDC2\uFE0F",
    label: heading,
    right: /*#__PURE__*/React.createElement("a", {
      href: "#",
      onClick: e => e.preventDefault(),
      style: {
        fontSize: 'var(--text-md)',
        color: 'var(--fg3)',
        textDecoration: 'none'
      }
    }, "Open in Documents \u2192")
  }), documents.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)'
    }
  }, emptyText), documents.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: '38px minmax(0,1fr) auto',
      gap: 11,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)',
      color: 'var(--fg2)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-xs)',
      padding: '4px 0',
      textAlign: 'center',
      textTransform: 'uppercase'
    }
  }, d.ext), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--text-md)',
      color: d.ext ? 'var(--blue)' : 'var(--fg1)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, d.name, d.restricted && isAdmin && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg3)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "lock",
    size: 13
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: tone(d)
    }
  }, d.shelf, " \xB7 ", d.when)), /*#__PURE__*/React.createElement("span", {
    "aria-label": "Detach",
    style: {
      color: 'var(--fg3)',
      fontSize: 'var(--text-sm)',
      cursor: 'pointer'
    }
  }, "\u2715"))), attachCandidates.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("select", {
    style: {
      flex: 1,
      border: '1px solid var(--bd2)',
      background: 'var(--card)',
      color: 'var(--fg1)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) 11px',
      fontSize: 'var(--text-md)',
      minHeight: 'var(--control-h)',
      fontFamily: 'inherit'
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }), attachCandidates.map(c => /*#__PURE__*/React.createElement("option", {
    key: c
  }, c))), /*#__PURE__*/React.createElement(__ds_scope.Button, null, "Attach")), addHref && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    href: addHref
  }, "\u2795 Add a document")));
  if (bare) return body;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--card)',
      border: '1px solid var(--bd)',
      borderRadius: 10,
      padding: '14px 16px'
    }
  }, body);
}
Object.assign(__ds_scope, { DocumentsCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DocumentsCard.jsx", error: String((e && e.message) || e) }); }

// components/data/TransactionRow.jsx
try { (() => {
function TransactionRow({
  row,
  open: openProp,
  onToggle,
  last = false
}) {
  const [openS, setOpenS] = React.useState(false);
  const open = openProp ?? openS;
  const [hover, setHover] = React.useState(false);
  const amountColor = row.negative ? 'var(--red)' : 'var(--green)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderBottom: last ? 0 : '1px solid var(--bd)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-expanded": open,
    onClick: () => {
      setOpenS(!open);
      onToggle && onToggle();
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'grid',
      gridTemplateColumns: '96px minmax(0,1fr) 150px 150px auto',
      alignItems: 'center',
      gap: 'var(--space-5)',
      width: '100%',
      minWidth: 0,
      padding: '8px var(--space-6)',
      background: hover || open ? 'var(--card3)' : 'none',
      border: 0,
      color: 'inherit',
      font: 'inherit',
      textAlign: 'left',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)'
    }
  }, row.date), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-md)',
      color: 'var(--fg1)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, row.merchant), open && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, row.detail ? row.detail + ' · ' : '', row.account, row.isTransfer ? ' · own transfer' : '')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-md)',
      fontWeight: 600,
      textAlign: 'right',
      color: amountColor
    }
  }, row.amount), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      minWidth: 0,
      fontSize: 'var(--text-sm)',
      color: 'var(--fg2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      flex: 'none',
      background: 'var(' + (row.categoryToken || '--fg3') + ')'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, row.categoryLabel || 'Uncategorised')), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 'var(--space-3)',
      lineHeight: 1,
      minWidth: 24
    }
  }, row.reviewState === 'needs_review' && /*#__PURE__*/React.createElement(__ds_scope.Pill, {
    hue: "yellow"
  }, "needs a look"), row.isSplit && /*#__PURE__*/React.createElement(__ds_scope.Pill, {
    hue: "purple"
  }, "split"), row.loanPayment && /*#__PURE__*/React.createElement(__ds_scope.Pill, {
    hue: "teal"
  }, "Loan payment \xB7 ", row.loanPayment), row.documents > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)',
      whiteSpace: 'nowrap'
    }
  }, "\uD83D\uDCCE", row.documents))), open && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)',
      padding: 'var(--space-5) var(--space-6) var(--space-6) calc(96px + var(--space-6) + var(--space-5))',
      background: 'var(--card2)',
      borderTop: '1px solid var(--bd2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Pill, {
    hue: row.reviewState === 'needs_review' ? 'yellow' : row.reviewState === 'confirmed' ? 'green' : 'grey'
  }, row.categoryLabel || 'Uncategorised', " \xB7 ", row.reviewState === 'needs_review' ? 'needs a look' : row.reviewState === 'confirmed' ? 'confirmed' : 'filed by rule'), /*#__PURE__*/React.createElement(__ds_scope.Button, null, row.categoryLabel ? 'Something else…' : 'File it…')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-5)',
      flexWrap: 'wrap',
      borderTop: '1px solid var(--bd)',
      paddingTop: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, (row.tags || []).map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      border: '1px solid var(--bd2)',
      borderRadius: 'var(--radius-pill)',
      padding: '3px 5px 3px 10px',
      fontSize: 'var(--text-sm)',
      color: 'var(--fg2)'
    }
  }, t, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg3)',
      fontSize: 'var(--text-xs)',
      padding: '0 3px'
    }
  }, "\u2715"))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)'
    }
  }, "+ tag")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, null, "Split"), /*#__PURE__*/React.createElement(__ds_scope.Button, null, "\uD83D\uDCCE Receipt"), /*#__PURE__*/React.createElement(__ds_scope.Button, null, "Make a rule"))), row.detail && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)'
    }
  }, row.detail)));
}
Object.assign(__ds_scope, { TransactionRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/TransactionRow.jsx", error: String((e && e.message) || e) }); }

// components/shell/Panel.jsx
try { (() => {
function Panel({
  title,
  icon,
  href,
  customising = false,
  fit = false,
  children,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--card)',
      border: '1px solid ' + (customising ? 'var(--bd2)' : 'var(--bd)'),
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-7) var(--space-8)',
      height: fit ? 'auto' : '100%',
      minHeight: 0,
      overflow: 'hidden',
      boxSizing: 'border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-5)',
      marginBottom: 10,
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 'var(--text-xs)',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--fg3)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  }), title), customising ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Remove",
    style: {
      background: 'var(--card2)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--fg3)',
      fontSize: 'var(--text-xs)',
      lineHeight: 1,
      padding: '4px 7px',
      cursor: 'pointer'
    }
  }, "\u2715")) : href && /*#__PURE__*/React.createElement("a", {
    href: href,
    onClick: e => e.preventDefault(),
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      flex: 'none',
      fontSize: 'var(--text-sm)',
      color: hover ? 'var(--fg1)' : 'var(--fg3)',
      whiteSpace: 'nowrap',
      textDecoration: 'none'
    }
  }, "Open \u2192")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowX: 'hidden',
      overflowY: fit ? 'visible' : 'auto',
      cursor: customising ? 'grab' : 'auto'
    }
  }, children), customising && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      right: 5,
      bottom: 5,
      width: 8,
      height: 8,
      borderRight: '2px solid var(--bd2)',
      borderBottom: '2px solid var(--bd2)'
    }
  }));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/Panel.jsx", error: String((e && e.message) || e) }); }

// components/shell/QuickAdd.jsx
try { (() => {
const QUICK_ADDS = [{
  href: '/import',
  label: 'Bank statements',
  icon: 'inbox'
}, {
  href: '/investments',
  label: 'XTB statement',
  icon: 'chart'
}, {
  href: '/calendar',
  label: 'Calendar event',
  icon: 'calendar'
}, {
  href: '/contacts',
  label: 'Contact',
  icon: 'people'
}, {
  href: '/documents?add=1',
  label: 'Document',
  icon: 'folders'
}, {
  href: '/salary?add=1',
  label: 'Payslip',
  icon: 'wallet'
}, {
  href: '/tax?add=1',
  label: 'Tax statement',
  icon: 'receipt'
}];
function Item({
  item
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("a", {
    href: item.href,
    role: "menuitem",
    onClick: e => e.preventDefault(),
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: 'var(--space-4) var(--space-5)',
      borderRadius: 7,
      color: 'var(--fg1)',
      fontSize: 'var(--text-md)',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      background: h ? 'color-mix(in srgb, var(--brand) 16%, transparent)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: item.icon,
    size: 16
  }), item.label);
}
function QuickAdd({
  items = QUICK_ADDS,
  open: openProp,
  fixed = true,
  style
}) {
  const [pinned, setPinned] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const open = openProp ?? (pinned || hover);
  return /*#__PURE__*/React.createElement("div", {
    role: "presentation",
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPinned(false);
    },
    style: {
      position: fixed ? 'fixed' : 'relative',
      right: fixed ? 24 : undefined,
      bottom: fixed ? 24 : undefined,
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 'var(--space-4)',
      ...style
    }
  }, open && /*#__PURE__*/React.createElement("div", {
    role: "menu",
    style: {
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg2)',
      border: '1px solid var(--bd2)',
      borderRadius: 'var(--radius-lg)',
      padding: 4,
      boxShadow: 'var(--shadow-float)',
      minWidth: 190
    }
  }, items.map(i => /*#__PURE__*/React.createElement(Item, {
    key: i.href,
    item: i
  }))), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Quick add",
    "aria-expanded": open,
    onClick: () => setPinned(!pinned),
    style: {
      display: 'grid',
      placeItems: 'center',
      border: 'none',
      cursor: 'pointer',
      width: 52,
      height: 52,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--brand)',
      color: 'var(--fg-inverse)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "plus",
    size: 24
  })));
}
Object.assign(__ds_scope, { QUICK_ADDS, QuickAdd });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/QuickAdd.jsx", error: String((e && e.message) || e) }); }

// components/shell/RateBanner.jsx
try { (() => {
function RateBanner({
  currencies = ['PLN'],
  onDismiss,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("p", {
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      margin: 0,
      padding: 'var(--space-6) var(--space-7)',
      border: '1px solid var(--bd2)',
      borderLeft: '3px solid var(--orange)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--card3)',
      color: 'var(--fg2)',
      fontSize: 'var(--text-md)',
      lineHeight: 1.5,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", null, "Approximate exchange rate for ", currencies.join(', '), "."), /*#__PURE__*/React.createElement(__ds_scope.InfoHint, {
    label: "Why this rate is approximate"
  }, children || 'No rate at all is stored for ' + currencies.join(', ') + ', so those amounts are counted at face value. Check the internet connection — rates come from the Czech National Bank and refresh every six hours.'), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss",
    onClick: onDismiss,
    style: {
      marginLeft: 'auto',
      border: 'none',
      background: 'none',
      color: 'var(--fg3)',
      fontSize: 'var(--text-2xl)',
      lineHeight: 1,
      padding: '0 4px',
      cursor: 'pointer'
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { RateBanner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/RateBanner.jsx", error: String((e && e.message) || e) }); }

// components/shell/ScreenHeader.jsx
try { (() => {
function ScreenHeader({
  title,
  caption,
  icon,
  hue = 'brand',
  syncedAt,
  actions,
  tabs = [],
  activeTab,
  onTab
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 26
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 24,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--text-4xl)',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      lineHeight: 1.2,
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      color: 'var(--fg1)'
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      color: 'var(--' + hue + ')'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 26
  })), /*#__PURE__*/React.createElement("span", null, title)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-md)',
      color: 'var(--fg3)'
    }
  }, caption)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      flexWrap: 'wrap'
    }
  }, syncedAt && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-md)',
      padding: '7px 11px',
      background: 'var(--card)',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "clock",
    size: 14
  }), " synced ", syncedAt), actions)), tabs.length > 1 && /*#__PURE__*/React.createElement("nav", {
    "aria-label": "screens",
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center',
      borderBottom: '1px solid var(--bd)',
      paddingBottom: 10,
      marginTop: -8,
      overflowX: 'auto',
      scrollbarWidth: 'none'
    }
  }, tabs.map(t => {
    const on = t === activeTab;
    return /*#__PURE__*/React.createElement("a", {
      key: t,
      href: '#' + t,
      "aria-current": on ? 'page' : undefined,
      onClick: e => {
        e.preventDefault();
        onTab && onTab(t);
      },
      style: {
        fontSize: 'var(--text-md)',
        color: on ? 'var(--fg1)' : 'var(--fg2)',
        fontWeight: on ? 500 : 400,
        padding: '5px 12px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
        flex: 'none',
        background: on ? 'var(--card3)' : 'transparent',
        textDecoration: 'none'
      }
    }, t);
  })));
}
Object.assign(__ds_scope, { ScreenHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/ScreenHeader.jsx", error: String((e && e.message) || e) }); }

// components/shell/Sidebar.jsx
try { (() => {
const AREAS = [{
  key: 'overview',
  label: 'Overview',
  icon: 'compass',
  hue: 'brand'
}, {
  key: 'money',
  label: 'Money',
  icon: 'flow',
  hue: 'teal'
}, {
  key: 'assets',
  label: 'Assets',
  icon: 'buildings',
  hue: 'purple'
}, {
  key: 'retirement',
  label: 'Retirement',
  icon: 'target',
  hue: 'blue'
}, {
  key: 'home',
  label: 'Home',
  icon: 'house',
  hue: 'orange'
}, {
  key: 'calendar',
  label: 'Calendar & Contacts',
  icon: 'calendar',
  hue: 'indigo'
}, {
  key: 'documents',
  label: 'Documents',
  icon: 'folders',
  hue: 'fg3'
}];
function NavItem({
  area,
  active,
  badge,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const hue = 'var(--' + area.hue + ')';
  return /*#__PURE__*/React.createElement("a", {
    href: '#' + area.key,
    "aria-current": active ? 'page' : undefined,
    onClick: e => {
      e.preventDefault();
      onClick && onClick(area.key);
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'grid',
      gridTemplateColumns: '20px minmax(0,1fr) auto',
      alignItems: 'center',
      gap: 'var(--space-5)',
      padding: 'var(--space-4) var(--space-5)',
      borderRadius: 'var(--radius-md)',
      color: active ? 'var(--fg1)' : 'var(--fg2)',
      fontSize: 'var(--text-md)',
      fontWeight: active ? 500 : 400,
      textDecoration: 'none',
      background: active ? 'color-mix(in srgb, ' + hue + ' 22%, transparent)' : hover ? 'color-mix(in srgb, ' + hue + ' 14%, transparent)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: hue,
      opacity: active || hover ? 1 : 0.75
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: area.icon
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, area.label), badge > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)',
      color: 'var(--fg-inverse)',
      background: 'var(--yellow)',
      borderRadius: 20,
      padding: '1px 6px'
    }
  }, badge));
}
function Sidebar({
  active = 'overview',
  onNavigate,
  areas = AREAS,
  householdLabel = 'Novák household (demo)',
  netWorth = '6 479 322.83',
  netWorthDelta,
  netWorthDeltaPositive = true,
  baseCurrency = 'Kč',
  importBadge = 0,
  version = '0.7.2',
  runtime = 'docker',
  theme = 'dark',
  onTheme,
  onSettings,
  settingsActive = false,
  style
}) {
  const tb = on => ({
    flex: '1 1 0',
    border: '1px solid ' + (on ? 'var(--bd2)' : 'var(--bd)'),
    background: on ? 'var(--card2)' : 'transparent',
    color: on ? 'var(--fg1)' : 'var(--fg3)',
    borderRadius: 'var(--radius-md)',
    padding: '7px 4px',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    fontFamily: 'inherit'
  });
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      background: 'var(--side)',
      borderRight: '1px solid var(--bd)',
      padding: '20px 14px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 22,
      height: '100%',
      overflowY: 'auto',
      width: 252,
      boxSizing: 'border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '0 8px'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.BrandMark, {
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xl)',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: 'var(--fg1)'
    }
  }, "Continuum"), /*#__PURE__*/React.createElement("a", {
    href: "#settings",
    "aria-label": "Settings",
    onClick: e => {
      e.preventDefault();
      onSettings && onSettings();
    },
    style: {
      marginLeft: 'auto',
      display: 'grid',
      placeItems: 'center',
      width: 26,
      height: 26,
      borderRadius: 'var(--radius-sm)',
      color: settingsActive ? 'var(--fg1)' : 'var(--fg3)',
      background: settingsActive ? 'var(--card2)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "gear",
    size: 16
  }))), netWorth !== null && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-5) var(--space-6)',
      border: '1px solid var(--bd)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--card)',
      display: 'flex',
      flexDirection: 'column',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      color: 'var(--fg3)'
    }
  }, "Net worth"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: 'var(--fg1)'
    }
  }, netWorth, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--fg3)',
      marginLeft: 5
    }
  }, baseCurrency)), netWorthDelta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: netWorthDeltaPositive ? 'var(--green)' : 'var(--red)'
    }
  }, netWorthDelta, " this month")), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-1)'
    }
  }, areas.map(a => /*#__PURE__*/React.createElement(NavItem, {
    key: a.key,
    area: a,
    active: active === a.key,
    badge: a.key === 'money' ? importBadge : 0,
    onClick: onNavigate
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)',
      borderTop: '1px solid var(--bd)',
      paddingTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: tb(theme === 'dark'),
    onClick: () => onTheme && onTheme('dark')
  }, "\uD83C\uDF19 Dark"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: tb(theme === 'light'),
    onClick: () => onTheme && onTheme('light')
  }, "\u2600\uFE0F Light")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: '0 4px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      borderRadius: 24,
      background: 'var(--card3)',
      display: 'grid',
      placeItems: 'center',
      fontSize: 'var(--text-xs)',
      flex: '0 0 auto',
      color: 'var(--fg1)'
    }
  }, householdLabel.slice(0, 1).toUpperCase()), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--fg2)',
      minWidth: 0,
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, householdLabel), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--fg2)',
      fontSize: 'var(--text-xs)',
      cursor: 'pointer',
      padding: '2px 0',
      fontFamily: 'inherit'
    }
  }, "Sign out")), /*#__PURE__*/React.createElement("a", {
    href: "#settings",
    onClick: e => e.preventDefault(),
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 5,
      fontSize: 'var(--text-xs)',
      color: 'var(--fg3)',
      textDecoration: 'none',
      letterSpacing: '0.01em'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, "v", version), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, runtime === 'docker' ? 'Docker' : 'Node'))));
}
Object.assign(__ds_scope, { AREAS, Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/continuum-app/App.jsx
try { (() => {
const {
  Sidebar,
  ScreenHeader,
  QuickAdd,
  RateBanner
} = window.ContinuumDesignSystem_bfc9d5;
const SCREENS = {
  overview: {
    area: 'overview',
    icon: 'compass',
    hue: 'brand',
    title: 'Overview',
    caption: 'August 2026 · as of the latest statement',
    tabs: []
  },
  transactions: {
    area: 'money',
    icon: 'ledger',
    hue: 'teal',
    title: 'Transactions',
    caption: 'Every row the ledger holds. Search it, narrow it, file what the rules missed.',
    tabs: ['Cash flow', 'Accounts', 'Transactions', 'Salary', 'Tax', 'Import', 'Rules']
  },
  accounts: {
    area: 'money',
    icon: 'bank',
    hue: 'teal',
    title: 'Accounts',
    caption: 'Balances stay in their own currency. Only totals convert.',
    tabs: ['Cash flow', 'Accounts', 'Transactions', 'Salary', 'Tax', 'Import', 'Rules']
  },
  loans: {
    area: 'assets',
    icon: 'card',
    hue: 'purple',
    title: 'Loans',
    caption: 'Every rate regime on record — a re-fix never rewrites booked interest.',
    tabs: ['Property', 'Investments', 'Loans']
  }
};
const AREA_HOME = {
  overview: 'overview',
  money: 'transactions',
  assets: 'loans'
};
const TAB_TO = {
  Transactions: 'transactions',
  Accounts: 'accounts',
  Loans: 'loans'
};
function App() {
  const [signedIn, setSignedIn] = React.useState(localStorage.getItem('continuum-kit-signed') === '1');
  const [screen, setScreen] = React.useState(localStorage.getItem('continuum-kit-screen') || 'overview');
  const [theme, setTheme] = React.useState(localStorage.getItem('continuum-kit-theme') || 'dark');
  const [banner, setBanner] = React.useState(true);
  React.useEffect(() => {
    if (theme === 'light') document.documentElement.setAttribute('data-ledger-theme', 'light');else document.documentElement.removeAttribute('data-ledger-theme');
    localStorage.setItem('continuum-kit-theme', theme);
  }, [theme]);
  React.useEffect(() => {
    localStorage.setItem('continuum-kit-screen', screen);
  }, [screen]);
  if (!signedIn) return /*#__PURE__*/React.createElement(LoginScreen, {
    onSignIn: () => {
      localStorage.setItem('continuum-kit-signed', '1');
      setSignedIn(true);
    }
  });
  const S = SCREENS[screen];
  const Body = {
    overview: OverviewScreen,
    transactions: TransactionsScreen,
    accounts: AccountsScreen,
    loans: LoansScreen
  }[screen];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '252px minmax(0,1fr)',
      minHeight: '100vh',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      top: 0,
      height: '100dvh'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: S.area,
    importBadge: 3,
    netWorth: window.CONTINUUM_DEMO.netWorth,
    theme: theme,
    onTheme: setTheme,
    onNavigate: k => {
      if (AREA_HOME[k]) setScreen(AREA_HOME[k]);
    }
  })), /*#__PURE__*/React.createElement("main", {
    style: {
      padding: '26px 32px 60px',
      display: 'flex',
      flexDirection: 'column',
      gap: 26,
      minWidth: 0
    }
  }, banner && /*#__PURE__*/React.createElement(RateBanner, {
    currencies: ['PLN'],
    onDismiss: () => setBanner(false)
  }), /*#__PURE__*/React.createElement(ScreenHeader, {
    icon: S.icon,
    hue: S.hue,
    title: S.title,
    caption: S.caption,
    tabs: S.tabs,
    activeTab: S.title,
    onTab: t => {
      if (TAB_TO[t]) setScreen(TAB_TO[t]);
    }
  }), /*#__PURE__*/React.createElement(Body, {
    setScreen: setScreen
  })), /*#__PURE__*/React.createElement(QuickAdd, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/continuum-app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/continuum-app/Screens.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Screens for the Continuum UI kit. Uses the design-system bundle (window.ContinuumDesignSystem_bfc9d5).
const DS = window.ContinuumDesignSystem_bfc9d5;
const {
  Icon,
  BrandMark,
  Button,
  Pill,
  MetricTile,
  Eyebrow,
  Segmented,
  Field,
  Input,
  Select,
  Checkbox,
  TransactionRow,
  AccountRow,
  BriefingCard,
  DocumentsCard,
  Panel
} = DS;
const D = window.CONTINUUM_DEMO;
const card = {
  background: 'var(--card)',
  border: '1px solid var(--bd)',
  borderRadius: 10,
  padding: '14px 16px'
};
function Bar({
  pct,
  color,
  height = 6
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      borderRadius: 3,
      background: 'var(--card3)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + '%',
      height: '100%',
      background: color
    }
  }));
}

// A static stand-in for the waterfall chart: the trunk and its peel-offs as stacked bands. The real layout algorithm lives in the repo.
function Waterfall() {
  const total = 471;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28,
      padding: '12px 16px 0'
    }
  }, [['In', D.flow.in, 'var(--green)'], ['Out', D.flow.out, 'var(--fg1)'], ['Saved', D.flow.saved, 'var(--green)'], ['Kept', D.flow.kept, 'var(--red)']].map(([l, v, c]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, l), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 19,
      fontWeight: 600,
      color: c
    }
  }, v, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--fg3)',
      marginLeft: 5
    }
  }, "K\u010D"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '150px 1fr 170px',
      gap: 12,
      alignItems: 'stretch',
      padding: '0 16px',
      minHeight: 300
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-around'
    }
  }, D.flow.sources.map(([n, v, p]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      textAlign: 'right',
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--fg1)'
    }
  }, n), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 11,
      color: 'var(--fg3)'
    }
  }, v)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 24 + p * 2,
      borderRadius: 2,
      background: n === 'From reserves' ? 'var(--series-taxes)' : 'var(--series-income)'
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      justifyContent: 'center'
    }
  }, D.flow.groups.map(([n, tok, pct]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      height: pct * 4.2,
      background: 'color-mix(in srgb, var(' + tok + ') 45%, transparent)',
      borderRight: '11px solid var(' + tok + ')',
      borderRadius: 2,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--fg1)',
      textShadow: '0 0 8px var(--bg), 0 0 8px var(--bg), 0 0 4px var(--bg), 0 0 2px var(--bg)'
    }
  }, n)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-around',
      fontSize: 12.5,
      color: 'var(--fg1)'
    }
  }, D.flow.groups.flatMap(([,,, leaves]) => leaves).map(l => /*#__PURE__*/React.createElement("span", {
    key: l
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(174px, 1fr))',
      gap: 16,
      padding: '4px 16px 8px',
      borderTop: '1px solid var(--bd)',
      paddingTop: 14
    }
  }, D.flow.groups.map(([n, tok, pct, leaves]) => /*#__PURE__*/React.createElement("div", {
    key: n
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 13,
      color: 'var(--fg1)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(' + tok + ')'
    }
  }), n, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--fg3)',
      fontSize: 12
    }
  }, pct, "%")), leaves.length > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg3)',
      marginTop: 4,
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, leaves.map(l => /*#__PURE__*/React.createElement("span", {
    key: l
  }, l)))))));
}
function OverviewScreen({
  setScreen
}) {
  const [period, setPeriod] = React.useState('ytd');
  const [customising, setCustomising] = React.useState(false);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    onClick: () => setCustomising(!customising)
  }, customising ? 'Done' : 'Customise')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(12, minmax(0,1fr))',
      gridAutoRows: 'minmax(40px, auto)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / span 12'
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    title: "Needs you",
    icon: "bell",
    customising: customising,
    fit: true
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 12
    }
  }, D.briefing.map(b => /*#__PURE__*/React.createElement(BriefingCard, _extends({
    key: b.title
  }, b)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / span 12'
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    title: "Where the money goes",
    icon: "flow",
    href: "/cashflow",
    customising: customising,
    fit: true
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Segmented, {
    options: [{
      value: 'ytd',
      label: 'Year to date'
    }, {
      value: 'm',
      label: 'This month'
    }, {
      value: '12',
      label: '12 months'
    }],
    value: period,
    onChange: setPeriod
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--fg3)'
    }
  }, period === 'm' ? 'August 2026' : period === '12' ? 'September 2025 – August 2026' : D.flow.period)), /*#__PURE__*/React.createElement("div", {
    style: {
      ...card,
      padding: 0
    }
  }, /*#__PURE__*/React.createElement(Waterfall, null)))), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / span 6'
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    title: "What it is made of",
    icon: "layers",
    customising: customising,
    fit: true
  }, D.composition.map(([n, v, tok, w]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      padding: '7px 0',
      borderTop: '1px solid var(--bd)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg2)'
    }
  }, n), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(' + tok + ')',
      fontWeight: 600
    }
  }, v)), /*#__PURE__*/React.createElement(Bar, {
    pct: w,
    color: 'var(' + tok + ')'
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '7 / span 6'
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    title: "Next 30 days",
    icon: "calendar",
    href: "/calendar",
    customising: customising,
    fit: true
  }, D.upcoming.map(([d, l, a, neg]) => /*#__PURE__*/React.createElement("div", {
    key: d + l,
    style: {
      display: 'grid',
      gridTemplateColumns: '90px 1fr auto',
      gap: 10,
      padding: '7px 0',
      borderTop: '1px solid var(--bd)',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--fg3)',
      fontSize: 12
    }
  }, d), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg1)'
    }
  }, l), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: neg ? 'var(--red)' : 'var(--green)'
    }
  }, a)))))));
}
function TransactionsScreen() {
  const [open, setOpen] = React.useState(1);
  const [size, setSize] = React.useState('25');
  const rows = D.transactions.slice(0, size === '5' ? 5 : D.transactions.length);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: card
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Search"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "counterparty, note, symbol"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "From"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "dd/mm/yyyy"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "To"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "dd/mm/yyyy"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Account"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ['All accounts', 'Fio běžný', 'Revolut', 'XTB portfolio']
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: 12,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Category"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ['Any category', 'Uncategorised', 'Groceries', 'Housing']
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Direction"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ['In and out', 'Money in', 'Money out']
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Min K\u010D"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "0",
    className: "mono"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Max K\u010D"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "\u221E",
    className: "mono"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "State"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ['Any state', 'filed by rule', 'needs a look', 'confirmed']
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      alignItems: 'end',
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Read as",
    style: {
      width: 240
    }
  }, /*#__PURE__*/React.createElement(Select, {
    options: ['However it was read', 'Exactly as printed', 'By the running balance']
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Show own transfers"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Apply"), /*#__PURE__*/React.createElement(Button, null, "Clear"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Eyebrow, {
    emoji: "\uD83D\uDCD2",
    label: "Matching",
    caption: "78 transactions \xB7 open a month to read it",
    style: {
      marginBottom: 12
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      ...card,
      padding: 0,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      padding: '10px 14px'
    }
  }, /*#__PURE__*/React.createElement(Segmented, {
    options: [{
      value: '5',
      label: '5'
    }, {
      value: '25',
      label: '25'
    }, {
      value: '50',
      label: '50'
    }],
    value: size,
    onChange: setSize
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 160px 160px 160px',
      padding: '10px 16px',
      borderTop: '1px solid var(--bd)',
      borderBottom: '1px solid var(--bd)',
      fontSize: 11,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--fg3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Month"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: 4,
      background: 'var(--green)',
      marginRight: 6
    }
  }), "In"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: 4,
      background: 'var(--red)',
      marginRight: 6
    }
  }), "Out"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, "Net")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 160px 160px 160px',
      padding: '14px 16px',
      borderBottom: '1px solid var(--bd)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--fg1)'
    }
  }, "All"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg3)'
    }
  }, "6 months \xB7 78 transactions")), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      textAlign: 'right',
      color: 'var(--green)'
    }
  }, "471 000"), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      textAlign: 'right',
      color: 'var(--red)'
    }
  }, "519 330"), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      textAlign: 'right',
      color: 'var(--red)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg3)',
      fontSize: 12,
      marginRight: 6
    }
  }, "K\u010D"), "\u221248 330")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 160px 160px 160px',
      padding: '14px 16px',
      borderBottom: '1px solid var(--bd)',
      alignItems: 'center',
      background: 'var(--card2)',
      boxShadow: 'inset 3px 0 0 var(--teal)'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--fg1)'
    }
  }, "\u25BE August 2026"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg3)',
      paddingLeft: 16
    }
  }, "13 transactions")), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      textAlign: 'right',
      color: 'var(--green)'
    }
  }, "78 500"), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      textAlign: 'right',
      color: 'var(--red)'
    }
  }, "86 555"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--red)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg3)',
      fontSize: 12,
      marginRight: 6
    }
  }, "K\u010D"), "\u22128 055"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      height: 3,
      borderRadius: 2,
      background: 'linear-gradient(90deg, var(--green) 47%, var(--red) 47%)'
    }
  }))), rows.map((r, i) => /*#__PURE__*/React.createElement(TransactionRow, {
    key: r.date + r.merchant,
    row: r,
    open: open === i,
    onToggle: () => setOpen(open === i ? -1 : i),
    last: i === rows.length - 1
  })))));
}
function AccountsScreen() {
  const [adding, setAdding] = React.useState(false);
  const grad = 'conic-gradient(' + D.donut.map(([, p, c], i, a) => {
    const from = a.slice(0, i).reduce((s, x) => s + x[1], 0);
    return c + ' ' + from + '% ' + (from + p) + '%';
  }).join(', ') + ')';
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: card
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    emoji: "\uD83C\uDFE6",
    label: "Accounts",
    caption: "native currency \xB7 318 365 K\u010D in total"
  })), D.accounts.map(a => /*#__PURE__*/React.createElement(React.Fragment, {
    key: a.name
  }, /*#__PURE__*/React.createElement(AccountRow, a), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 0',
      borderTop: '1px solid var(--bd)'
    }
  }, /*#__PURE__*/React.createElement(DocumentsCard, {
    bare: true,
    heading: "Statements and reports",
    documents: a.docs,
    attachCandidates: ['Attach a document you already have…']
  })))), adding ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
      gap: 8,
      paddingTop: 12,
      borderTop: '1px solid var(--bd)'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Name (e.g. Fio joint account)"
  }), /*#__PURE__*/React.createElement(Select, {
    options: ['Fio', 'ČS', 'mBank', 'Revolut', '➕ Add a bank…']
  }), /*#__PURE__*/React.createElement(Select, {
    options: ['CZK', 'EUR', 'USD', 'PLN']
  }), /*#__PURE__*/React.createElement(Select, {
    options: ['Joint', 'Jana Nováková', 'Petr Novák']
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setAdding(false)
  }, "Add")) : /*#__PURE__*/React.createElement("div", {
    style: {
      paddingTop: 12,
      borderTop: '1px solid var(--bd)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: () => setAdding(true)
  }, "\u2795 Add account"))), /*#__PURE__*/React.createElement("div", {
    style: card
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    emoji: "\uD83D\uDD01",
    label: "Transfers between your own accounts"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0',
      fontSize: 13,
      color: 'var(--fg3)'
    }
  }, "matched automatically \xB7 never counted as income or expense"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 13,
      color: 'var(--fg3)'
    }
  }, "Matched pairs from imported statements will appear here."))), /*#__PURE__*/React.createElement("div", {
    style: card
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    emoji: "\uD83E\uDD67",
    label: "Where the cash sits"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28,
      alignItems: 'center',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 148,
      height: 148,
      borderRadius: '50%',
      background: grad,
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 96,
      height: 96,
      borderRadius: '50%',
      background: 'var(--bg)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, "318 365"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, D.donut.map(([n, p, c]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: c
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg2)',
      width: 120
    }
  }, n), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--fg3)'
    }
  }, p.toFixed(1), "%")))))));
}
function LoansScreen() {
  const L = D.loan;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, {
    emoji: "\uD83D\uDCB3",
    label: "What you owe",
    caption: "1 loan"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(MetricTile, {
    label: "Total owed",
    value: "9 270 000",
    unit: "K\u010D",
    color: "var(--red)"
  }), /*#__PURE__*/React.createElement(MetricTile, {
    label: "Monthly payments",
    value: "54 456",
    unit: "K\u010D"
  }), /*#__PURE__*/React.createElement(MetricTile, {
    label: "Interest this year",
    value: "138 895.90",
    unit: "K\u010D",
    color: "var(--orange)",
    note: "projected from 2026-09"
  }), /*#__PURE__*/React.createElement(MetricTile, {
    label: "Debt-free",
    value: "2049",
    note: "at current payments"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...card,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 600
    }
  }, L.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--fg3)',
      marginTop: 3
    }
  }, L.line)), /*#__PURE__*/React.createElement(Pill, {
    hue: "green"
  }, L.pill)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Add tag\u2026",
    style: {
      width: 190
    }
  })), /*#__PURE__*/React.createElement(DocumentsCard, {
    bare: true,
    documents: [],
    emptyText: "Nothing filed about this loan yet \u2014 the agreement and each re-fix letter belong here.",
    attachCandidates: ['Attach a document you already have…'],
    addHref: "/documents?add=1"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12
    }
  }, [['Owed', L.owed, 'var(--red)'], ['Payment', L.payment], ['Rate', L.rate], ['Ends', L.ends]].map(([l, v, c]) => /*#__PURE__*/React.createElement("div", {
    key: l
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg3)'
    }
  }, l), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 14,
      color: c || 'var(--fg1)'
    }
  }, v)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Bar, {
    pct: L.repaid,
    color: "var(--green)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg3)',
      marginTop: 6
    }
  }, L.repaidLine)), /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      fontSize: 13
    }
  }, "Schedule & changes \u25BE")), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px dashed var(--bd2)',
      borderRadius: 10,
      padding: '20px 24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 500
    }
  }, "\u2795 Add loan"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--fg3)',
      marginTop: 4
    }
  }, "Mortgage, car, consumer, or a loan to family. Payments then match themselves from your statements.")));
}
function LoginScreen({
  onSignIn
}) {
  const people = [['JN', 'Jana Nováková'], ['PN', 'Petr Novák']];
  const [who, setWho] = React.useState(0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 380,
      margin: '0 auto',
      padding: '90px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement(BrandMark, {
    size: 26
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 600,
      letterSpacing: '-0.01em'
    }
  }, "Continuum")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 12,
      color: 'var(--fg3)',
      textAlign: 'center'
    }
  }, "Passkeys work at ", /*#__PURE__*/React.createElement("code", {
    className: "mono"
  }, "https://continuum.local"), " \u2014 sign in with a password here."), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onSignIn();
    },
    style: {
      ...card,
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, people.map(([i, n], k) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: n,
    onClick: () => setWho(k),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      border: '1px solid ' + (who === k ? 'var(--bd2)' : 'var(--bd)'),
      background: who === k ? 'var(--card2)' : 'transparent',
      color: who === k ? 'var(--fg1)' : 'var(--fg2)',
      borderRadius: 8,
      padding: '9px 11px',
      fontSize: 13,
      cursor: 'pointer',
      textAlign: 'left',
      fontFamily: 'inherit'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: 26,
      background: 'var(--card3)',
      display: 'grid',
      placeItems: 'center',
      fontSize: 11
    }
  }, i), n))), /*#__PURE__*/React.createElement(Input, {
    type: "password",
    placeholder: "Password",
    defaultValue: "demo-demo-demo"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    type: "submit"
  }, "Sign in")));
}
Object.assign(window, {
  OverviewScreen,
  TransactionsScreen,
  AccountsScreen,
  LoansScreen,
  LoginScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/continuum-app/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/continuum-app/data.js
try { (() => {
// Demo household fixtures — realistic shape and magnitude, matching the product's demo instance.
window.CONTINUUM_DEMO = {
  household: 'Novák household (demo)',
  netWorth: '6 479 322.83',
  delta: '+184 300',
  briefing: [{
    kind: 'Paper',
    icon: 'inbox',
    pill: '2 waiting',
    hue: 'blue',
    title: '2 documents waiting to be filed',
    body: 'Until they are filed, no record shows them and no expiry date is watched.'
  }, {
    kind: 'Mortgage',
    icon: 'bank',
    pill: 'Aug 2028',
    hue: 'grey',
    title: 'Mortgage ČS fixation runs to Aug 2028',
    body: 'Nothing to do yet. Refinancing quotes are worth collecting from 2027.'
  }, {
    kind: 'Document',
    icon: 'folders',
    pill: '2 months',
    hue: 'yellow',
    title: 'Home insurance · Flat Vinohrady renews 2026-10-19',
    body: 'Filed under Property, about Flat Vinohrady.'
  }, {
    kind: 'Tenancy',
    icon: 'key',
    pill: '63 days',
    hue: 'grey',
    title: 'Flat Karlín lease ends 2026-11-01',
    body: 'Martin Dvořák is the tenant. Renewal notice is due by 2026-09-01.'
  }],
  flow: {
    in: '471 000',
    out: '440 316.30',
    saved: '79 013.70',
    kept: '−48 330',
    period: 'January – August 2026',
    groups: [['Housing', '--series-housing', 41, ['Mortgage · home', 'Mortgage ČS · interest', 'SVJ & insurance']], ['Saved & invested', '--series-savings', 17, ['Brokerage transfers', 'Mortgage ČS · principal']], ['Food & lifestyle', '--series-living', 22, ['Groceries', 'Eating out', 'Everything else']], ['Bills & utilities', '--series-bills', 9, ['Energy', 'Phone']], ['Transport', '--series-transport', 6, ['Fuel & tolls']], ['Taxes & fees', '--series-taxes', 5, ['Bank fees']]],
    sources: [['Salary', '372 000', 72], ['Rent received', '99 000', 19], ['From reserves', '48 330', 9]]
  },
  composition: [['Flats net of mortgage', '8 200 000', '--series-housing', 100], ['Investments', '1 672 500', '--series-savings', 20], ['Cash', '921 400', '--series-income', 11], ['Other loans', '−218 000', '--series-taxes', 3]],
  upcoming: [['2026-09-01', 'Mortgage ČS instalment', '−54 456', true], ['2026-09-01', 'Rent · Flat Karlín', '+33 000', false], ['2026-09-05', 'Salary · Jana', '+62 000', false], ['2026-09-12', 'SVJ Vinohradská', '−4 850', true], ['2026-09-19', 'O2 Czech Republic', '−649', true]],
  transactions: [{
    date: '2026-08-25',
    merchant: 'XTB deposit',
    account: 'Fio běžný',
    amount: '−10 000 Kč',
    negative: true,
    categoryLabel: 'Brokerage transfers',
    categoryToken: '--series-savings',
    reviewState: 'confirmed'
  }, {
    date: '2026-08-22',
    merchant: 'Kaufland',
    detail: 'VS 0000123 · card 4891',
    account: 'Fio běžný',
    amount: '−2 740 Kč',
    negative: true,
    categoryLabel: 'Groceries',
    categoryToken: '--series-living',
    reviewState: 'auto'
  }, {
    date: '2026-08-20',
    merchant: 'Alza.cz',
    account: 'Fio běžný',
    amount: '−1 190 Kč',
    negative: true,
    categoryLabel: 'Everything else',
    categoryToken: '--series-living',
    reviewState: 'needs_review'
  }, {
    date: '2026-08-18',
    merchant: 'Restaurace U Nováků',
    account: 'Revolut',
    amount: '−2 450 Kč',
    negative: true,
    categoryLabel: 'Eating out',
    categoryToken: '--series-living',
    reviewState: 'auto',
    detail: '92.40 € at 26.52'
  }, {
    date: '2026-08-15',
    merchant: 'Lidl',
    account: 'Fio běžný',
    amount: '−2 880 Kč',
    negative: true,
    categoryLabel: 'Groceries',
    categoryToken: '--series-living',
    reviewState: 'auto'
  }, {
    date: '2026-08-12',
    merchant: 'Shell',
    account: 'Fio běžný',
    amount: '−1 820 Kč',
    negative: true,
    categoryLabel: 'Fuel & tolls',
    categoryToken: '--series-transport',
    reviewState: 'auto',
    documents: 1,
    tags: ['Car']
  }, {
    date: '2026-08-11',
    merchant: 'O2 Czech Republic',
    account: 'Fio běžný',
    amount: '−649 Kč',
    negative: true,
    categoryLabel: 'Phone',
    categoryToken: '--series-bills',
    reviewState: 'auto'
  }, {
    date: '2026-08-10',
    merchant: 'ČEZ Prodej',
    account: 'Fio běžný',
    amount: '−2 400 Kč',
    negative: true,
    categoryLabel: 'Energy',
    categoryToken: '--series-bills',
    reviewState: 'auto'
  }, {
    date: '2026-08-06',
    merchant: 'SVJ Vinohradská',
    account: 'Fio běžný',
    amount: '−4 850 Kč',
    negative: true,
    categoryLabel: 'SVJ & insurance',
    categoryToken: '--series-housing',
    reviewState: 'auto'
  }, {
    date: '2026-08-05',
    merchant: 'Salary · Acme s.r.o.',
    account: 'Fio běžný',
    amount: '62 000 Kč',
    categoryLabel: 'Salary',
    categoryToken: '--series-income',
    reviewState: 'confirmed'
  }, {
    date: '2026-08-01',
    merchant: 'Mortgage ČS',
    account: 'Fio běžný',
    amount: '−54 456 Kč',
    negative: true,
    categoryLabel: 'Mortgage · home',
    categoryToken: '--series-housing',
    reviewState: 'confirmed',
    loanPayment: 'Mortgage ČS'
  }],
  accounts: [{
    emoji: '🏦',
    name: 'Fio běžný',
    numbers: ['2101106516/2010'],
    meta: 'CZK · Jana Nováková · statement to 2026-08-30',
    balance: '243 500',
    docs: [{
      ext: 'pdf',
      name: 'Fio běžný · 2026-07',
      shelf: 'Statements',
      when: 'added 30 Aug 2026'
    }]
  }, {
    emoji: '💳',
    name: 'Revolut',
    meta: 'EUR · Petr Novák · statement to 2026-08-30',
    balance: '3 100',
    baseEquivalent: '≈ 74 865 Kč',
    docs: [{
      ext: 'pdf',
      name: 'Revolut · 2026-07',
      shelf: 'Statements',
      when: 'added 30 Aug 2026'
    }]
  }, {
    emoji: '📈',
    name: 'XTB portfolio',
    meta: 'CZK · Jana Nováková · statement to 2026-08-30',
    balance: '1 250',
    docs: [{
      ext: 'pdf',
      name: 'XTB report 2025-12-01',
      shelf: 'Statements',
      when: 'added 30 Aug 2026'
    }]
  }],
  donut: [['Fio běžný', 76.5, 'var(--series-savings)'], ['Revolut', 23.1, 'var(--series-income)'], ['XTB portfolio', 0.4, 'var(--series-housing)']],
  loan: {
    name: 'Mortgage ČS',
    line: 'Česká spořitelna · 4.44% · secured by Flat Vinohrady + Flat Karlín',
    pill: 'fixed to Aug 2028',
    owed: '9 270 000',
    payment: '54 456',
    rate: '4.44%',
    ends: '2049',
    repaid: 6.4,
    repaidLine: '630 000 of 9 900 000 repaid'
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/continuum-app/data.js", error: String((e && e.message) || e) }); }

__ds_ns.ActionError = __ds_scope.ActionError;

__ds_ns.BrandMark = __ds_scope.BrandMark;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.ICONS = __ds_scope.ICONS;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.InfoHint = __ds_scope.InfoHint;

__ds_ns.ListPager = __ds_scope.ListPager;

__ds_ns.MetricTile = __ds_scope.MetricTile;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.PersonTag = __ds_scope.PersonTag;

__ds_ns.Pill = __ds_scope.Pill;

__ds_ns.Segmented = __ds_scope.Segmented;

__ds_ns.UploadDropzone = __ds_scope.UploadDropzone;

__ds_ns.AccountRow = __ds_scope.AccountRow;

__ds_ns.BriefingCard = __ds_scope.BriefingCard;

__ds_ns.DocumentsCard = __ds_scope.DocumentsCard;

__ds_ns.TransactionRow = __ds_scope.TransactionRow;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.QUICK_ADDS = __ds_scope.QUICK_ADDS;

__ds_ns.QuickAdd = __ds_scope.QuickAdd;

__ds_ns.RateBanner = __ds_scope.RateBanner;

__ds_ns.ScreenHeader = __ds_scope.ScreenHeader;

__ds_ns.AREAS = __ds_scope.AREAS;

__ds_ns.Sidebar = __ds_scope.Sidebar;

})();
