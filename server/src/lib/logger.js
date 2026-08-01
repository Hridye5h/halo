const stamp = () => new Date().toISOString().slice(11, 23);

const paint = (color, label) => `\x1b[${color}m${label}\x1b[0m`;

export const log = {
  info: (...a) => console.log(paint(36, `[${stamp()}] info `), ...a),
  warn: (...a) => console.warn(paint(33, `[${stamp()}] warn `), ...a),
  error: (...a) => console.error(paint(31, `[${stamp()}] error`), ...a),
  socket: (...a) => console.log(paint(35, `[${stamp()}] ws   `), ...a),
};
