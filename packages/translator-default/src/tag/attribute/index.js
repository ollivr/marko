import fs from "fs";
import { join, basename } from "path";
import { isNativeTag, getTagDef } from "@marko/babel-utils";

const directives = requireDir(join(__dirname, "directives"));
const modifiers = requireDir(join(__dirname, "modifiers"));
const EMPTY_ARRAY = [];
const EVENT_REG = /^(on(?:ce)?)(-)?(.*)$/;
const attachedDetachedLoaded = new WeakSet();

export default {
  enter(attr) {
    const { hub } = attr;
    const tag = attr.parentPath;
    const value = attr.get("value");
    const { name, arguments: args } = attr.node;
    const isVDOM = hub.options.output !== "html";

    if (execModifiersAndDirectives("enter", tag, attr, value)) {
      return;
    }

    // Event handlers.
    let [, eventType, isDash, eventName] = EVENT_REG.exec(name) || EMPTY_ARRAY;

    if (eventType && args) {
      if (!args.length) {
        throw attr.buildCodeFrameError("Event handler is missing arguments.");
      }

      if (!value.isBooleanLiteral(true)) {
        throw value.buildCodeFrameError(
          `"${name}(handler, ...args)" does not accept a value.`
        );
      }

      if (!isDash) {
        // When the event is not in dash case we normalized differently for html tags and custom tags.

        if (isNativeTag(tag)) {
          // Lowercase the string
          // Example: onMouseOver → mouseover
          eventName = eventName.toLowerCase();
        } else {
          // Convert first character to lower case:
          // Example: onBeforeShow → beforeShow
          eventName = eventName.charAt(0).toLowerCase() + eventName.slice(1);
        }
      }

      const handlers = (tag.node.handlers = tag.node.handlers || {});
      if (handlers[eventName]) {
        throw attr.buildCodeFrameError(
          "Duplicate event handlers are not supported."
        );
      }

      handlers[eventName] = {
        arguments: args,
        once: eventType === "once"
      };

      if (isVDOM) {
        if (eventName === "attach" || eventName === "detach") {
          if (!attachedDetachedLoaded.has(hub)) {
            // Pull in helper for element attach/detach;
            attachedDetachedLoaded.add(hub);
            hub.importDefault(
              tag,
              "marko/src/runtime/components/attach-detach"
            );
          }
        }
      }

      attr.remove();
      return;
    }
  },
  exit(attr) {
    const tag = attr.parentPath;
    const { name, arguments: args } = attr.node;
    const value = attr.get("value");

    if (execModifiersAndDirectives("exit", tag, attr, value)) {
      return;
    }

    const tagDef = getTagDef(tag);

    if (tagDef) {
      if (!tagDef.html && !tagDef.getAttribute(name)) {
        throw attr.buildCodeFrameError(
          `<${
            tag.get("name.value").node
          }> does not support the "${name}" attribute.`
        );
      }
    }

    if (args && args.length) {
      throw attr.buildCodeFrameError(
        `Unsupported arguments on the "${name}" attribute.`
      );
    }
  }
};

function execModifiersAndDirectives(type, tag, attr, value) {
  const { name, modifier } = attr.node;

  if (modifier) {
    const modifierTranslate = modifiers[modifier];
    if (modifierTranslate) {
      if (modifierTranslate[type]) {
        const tagNode = tag.node;
        const attrNode = attr.node;
        modifierTranslate[type](tag, attr, value);
        if (tag.node !== tagNode || attr.node !== attrNode) return true;
      }
    } else {
      throw attr.buildCodeFrameError(`Unsupported modifier "${modifier}".`);
    }
  }

  const directiveTranslate = directives[name];
  if (directiveTranslate) {
    if (directiveTranslate[type]) {
      const tagNode = tag.node;
      const attrNode = attr.node;
      directiveTranslate[type](tag, attr, value);
      if (tag.node !== tagNode || attr.node !== attrNode) return true;
    }
  }
}

function requireDir(dir) {
  return fs
    .readdirSync(dir)
    .filter(entry => /\.js$/.test(entry))
    .map(entry => join(dir, entry))
    .reduce((r, file) => {
      r[basename(file).replace(/\.js$/, "")] = require(file).default;
      return r;
    }, {});
}