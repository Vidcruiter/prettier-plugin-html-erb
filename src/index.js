import { parse } from "./parser.js";
import { print, embed, getVisitorKeys } from "./printer.js";

const PLUGIN_KEY = "erb-template";

export const languages = [
  {
    name: "htmlErbTemplate",
    parsers: [PLUGIN_KEY],
    extensions: [".html.erb"],
  },
];

export const parsers = {
  [PLUGIN_KEY]: {
    astFormat: PLUGIN_KEY,
    parse,
    locStart: (node) => node.index,
    locEnd: (node) => node.index + node.length,
  },
};

export const printers = {
  [PLUGIN_KEY]: {
    print,
    embed,
    getVisitorKeys,
  }
}

export const options = {
  rubyNewLineBlock: {
    type: "boolean",
    category: "Global",
    default: false,
    description: "Put the opening and closing erb tags for multi-line blocks on new lines",
  },
};

export const defaultOptions = {
  trailingComma: "none"
};
