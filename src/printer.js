import { doc } from "prettier";
const { utils, builders } = doc;

const { concat, hardline } = doc.builders;

process.env.PRETTIER_DEBUG = "true";

export const getVisitorKeys = (ast) => {
  if ("type" in ast) {
    return ast.type === "root" ? ["nodes"] : [];
  }

  return Object.values(ast)
    .filter((node) => {
      return node.type === "block";
    })
    .map((e) => e.id);
};

export function print(path, options, print) {
  const node = path.node;
  if (!node) {
    return [];
  }

  if (node.type === "expression") {
    return printExpression(node);
  }

  if (node.type === "statement") {
    return printStatement(node);
  }

  if (node.type === "comment") {
    return builders.group([builders.join(" ", ["<%#", node.content, "%>"])], {
      shouldBreak: true, // I dunno if this will have consequences in another parts
    });
  }

  return [];
}

export function embed() {
  return async (textToDoc, print, path, options) => {
    const node = path.node;

    // Format ruby code before constructing the Doc
    if ("nodes" in node) {
      for (const n of Object.values(node.nodes)) {
        if (!n.contentPreRubyParser) {
          await formatRubyCode(n, textToDoc, options);
        }
      }
    }

    if (!node || !["root", "block"].includes(node.type)) {
      return undefined;
    }

    const mapped = await Promise.all(
      splitAtElse(node).map(async (content) => {
        let doc;
        if (content in node.nodes) {
          doc = content;
        } else {
          doc = await textToDoc(content, { ...options, parser: "html" });
        }

        return utils.mapDoc(doc, (currentDoc) => {
          if (typeof currentDoc !== "string") {
            return currentDoc;
          }

          const idxs = findPlaceholders(currentDoc);
          if (idxs.length === 0) {
            return currentDoc;
          }
          let res = [];
          let lastEnd = 0;

          for (const { start, end } of idxs) {
            if (lastEnd < start) {
              res.push(currentDoc.slice(lastEnd, start));
            }

            const p = currentDoc.slice(start, end);

            if (p in node.nodes) {
              res.push(path.call(print, "nodes", p));
            } else {
              res.push(p);
            }

            lastEnd = end;
          }

          if (lastEnd > 0 && currentDoc.length > lastEnd) {
            res.push(currentDoc.slice(lastEnd));
          }

          return res;
        });
      }),
    );

    if (node.type === "block") {
      return builders.group([
        path.call(print, "nodes", node.start.id),
        builders.indent([builders.softline, mapped]),
        builders.hardline,
        path.call(print, "nodes", node.end.id),
      ]);
    }

    return [...mapped, builders.hardline];
  };
}

const splitAtElse = (node) => {
  const elseNodes = Object.values(node.nodes).filter(
    (n) =>
      n.type === "statement" &&
      ["else", "elsif"].includes(n.keyword) &&
      node.content.search(n.id) !== -1,
  );

  if (elseNodes.length === 0) {
    return [node.content];
  }

  const re = new RegExp(`(${elseNodes.map((e) => e.id).join(")|(")})`);
  return node.content.split(re).filter(Boolean);
};

export const findPlaceholders = (text) => {
  let i = 0;
  let res = [];

  let match;
  while ((match = text.slice(i).match(/#~\d+~#/)) != null) {
    const matchLength = match[0].length;

    res.push({
      id: match[0],
      start: i + match.index,
      end: i + match.index + match[0].length,
    });

    i += match.index + matchLength;
  }

  return res;
};

const printExpression = (node) => {
  const multiline = node.content.includes("\n");

  if (multiline) {
    const lines = node.content.split("\n");
    const templateIndicatorSpace = " ".repeat("<%= ".length);

    return concat([
      ["<%=", " "],
      ...lines.map((line, i) => [
        i !== 0 ? templateIndicatorSpace : "",
        line,
        i !== lines.length - 1 ? hardline : "",
      ]),
      [" ", "%>"],
    ]);
  }

  return builders.group(
    builders.join(" ", ["<%=", builders.indent(node.content), "%>"]),
  );
};

const printStatement = (node) => {
  const multiline = node.content.includes("\n");

  if (multiline) {
    const lines = node.content.split("\n");
    const templateIndicatorSpace = " ".repeat("<% ".length);

    return concat([
      ["<%", " "],
      ...lines.map((line, i) => [
        i !== 0 ? templateIndicatorSpace : "",
        line,
        i !== lines.length - 1 ? hardline : "",
      ]),
      [" ", "%>"],
    ]);
  }

  const statement = builders.group(
    builders.join(" ", ["<%", node.content, "%>"]),
  );

  if (["else", "elsif"].includes(node.keyword)) {
    return [builders.dedent(builders.hardline), statement, builders.hardline];
  }

  return statement;
};

const IF_BLOCK_FALSE = "if true\n";
const END_BLOCK_FALSE = "\nend";
const INCOHERENT_LINES = "\n  @var = 2\n  @var3 = 4";

const formatStatementBlock = async (node, textToDoc, options) => {
  if (node.keyword === "if") {
    const contentFalsed = node.content + END_BLOCK_FALSE;
    const doc = await textToDoc(contentFalsed, { ...options, parser: "ruby" });
    return doc.slice(0, -END_BLOCK_FALSE.length);
  }

  if (node.keyword === "else") {
    const contentFalsed = IF_BLOCK_FALSE + node.content + END_BLOCK_FALSE;
    const doc = await textToDoc(contentFalsed, { ...options, parser: "ruby" });
    return doc.slice(IF_BLOCK_FALSE.length, -END_BLOCK_FALSE.length);
  }

  if (node.keyword === "elsif") {
    const contentFalsed = IF_BLOCK_FALSE + node.content + END_BLOCK_FALSE;
    const doc = await textToDoc(contentFalsed, { ...options, parser: "ruby" });
    return doc.slice(IF_BLOCK_FALSE.length, -END_BLOCK_FALSE.length);
  }

  const contentFalsed = node.content + INCOHERENT_LINES + END_BLOCK_FALSE;
  let doc = await textToDoc(contentFalsed, { ...options, parser: "ruby" });
  return doc.slice(0, -(INCOHERENT_LINES.length + END_BLOCK_FALSE.length));
};

const formatExpressionBlock = async (node, textToDoc, options) => {
  const contentWithEnd = node.content + END_BLOCK_FALSE;
  const doc = await textToDoc(contentWithEnd, { ...options, parser: "ruby" });
  return doc.slice(0, -END_BLOCK_FALSE.length);
};

const formatRubyCode = async (node, textToDoc, options) => {
  if (
    !["expression", "statement"].includes(node.type) ||
    node.keyword === "end"
  ) {
    return;
  }

  let doc;
  if (node.startBlock || ["else", "elsif"].includes(node.keyword)) {
    if (node.type === "expression") {
      doc = await formatExpressionBlock(node, textToDoc, options);
    }
    if (node.type === "statement") {
      doc = await formatStatementBlock(node, textToDoc, options);
    }
  } else {
    doc = await textToDoc(node.content, { ...options, parser: "ruby" });
  }

  node.contentPreRubyParser = node.content;
  node.content = doc;
};
