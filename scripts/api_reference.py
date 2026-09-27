"""Render the package's autodoc directives as Markdown.

The FastMDXplora docs are written for Sphinx, and their API sections are
``eval-rst`` blocks holding ``automodule`` and ``autoclass`` directives. This
script reads those directives as JSON on stdin and writes Markdown for each on
stdout, taken from the package's own source and docstrings. The package is
read statically, never imported, so no MD dependency has to be installed.

Input:  {"src": "<path to src/>", "blocks": ["<directive text>", ...]}
Output: {"blocks": ["<markdown>", ...]}
"""

from __future__ import annotations

import json
import logging
import re
import sys
import textwrap

import griffe

logging.getLogger("griffe").setLevel(logging.ERROR)

DIRECTIVE = re.compile(r"^\.\.\s+(automodule|autoclass|autofunction)::\s+(\S+)\s*$")
OPTION = re.compile(r"^\s+:([a-z-]+):")
ROLE = re.compile(r":(?:py:)?[a-z]+:`(~?)([^`<]+?)(?:\s*<([^>]+)>)?`")
EXTERNAL = re.compile(r"`([^`<]+?)\s*<(https?://[^>]+)>`_")
UNDERLINE = re.compile(r"^(\S[^\n]*)\n[-=~^]{3,}\s*$", re.MULTILINE)


def parse_directives(text: str) -> list[dict]:
    """Split one eval-rst block into its directives and their options."""
    found: list[dict] = []
    for line in text.splitlines():
        head = DIRECTIVE.match(line)
        if head:
            found.append({"kind": head.group(1), "target": head.group(2), "options": set()})
            continue
        option = OPTION.match(line)
        if option and found:
            found[-1]["options"].add(option.group(1))
    return found


def inline(text: str) -> str:
    """Convert reStructuredText inline markup to Markdown."""
    text = EXTERNAL.sub(r"[\1](\2)", text)

    def role(match: re.Match) -> str:
        tilde, target, explicit = match.groups()
        if explicit:
            return f"`{target.strip()}`"
        target = target.strip()
        return f"`{target.rsplit('.', 1)[-1] if tilde else target}`"

    text = ROLE.sub(role, text)
    text = re.sub(r"``(.+?)``", r"`\1`", text)
    return escape_html(text)


def escape_html(text: str) -> str:
    """Escape angle brackets outside code spans, so ``<run>`` stays text."""
    parts = re.split(r"(`[^`]*`)", text)
    return "".join(p if p.startswith("`") else p.replace("<", "&lt;") for p in parts)


def prose(text: str) -> str:
    """Convert a docstring's free text: titles, literal blocks, doctests, notes."""
    text = textwrap.dedent(text).strip("\n")
    text = UNDERLINE.sub(lambda m: f"**{m.group(1).strip()}**", text)
    out: list[str] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        admonition = re.match(r"^\.\.\s+(note|warning|important|tip|caution|seealso)::\s*(.*)$", stripped)
        if admonition:
            body = [admonition.group(2)] if admonition.group(2) else []
            i += 1
            while i < len(lines) and (not lines[i].strip() or lines[i].startswith((" ", "\t"))):
                body.append(lines[i].strip())
                i += 1
            label = "See also" if admonition.group(1) == "seealso" else admonition.group(1).capitalize()
            joined = " ".join(b for b in body if b)
            out.append(f"> **{label}.** {inline(joined)}")
            out.append("")
            continue
        if stripped.startswith(">>>"):
            block = []
            while i < len(lines) and lines[i].strip():
                block.append(lines[i].strip())
                i += 1
            out.extend(["```python", *block, "```"])
            continue
        if stripped.endswith("::"):
            lead = stripped[:-2].rstrip()
            if lead:
                out.append(inline(lead + ":"))
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            block = []
            while i < len(lines) and (not lines[i].strip() or lines[i].startswith((" ", "\t"))):
                block.append(lines[i])
                i += 1
            while block and not block[-1].strip():
                block.pop()
            out.extend(["", "```python", textwrap.dedent("\n".join(block)), "```", ""])
            continue
        out.append(inline(line))
        i += 1
    return "\n".join(out).strip()


def annotation(value) -> str:
    return "" if value is None else str(value)


def signature(obj) -> str:
    """A Python signature line for a function, method or class."""
    params = obj.parameters if obj.is_function else _init_parameters(obj)
    parts: list[str] = []
    seen_kw_only = False
    for p in params:
        if p.name in ("self", "cls"):
            continue
        kind = p.kind.value
        if kind == "keyword-only" and not seen_kw_only:
            parts.append("*")
            seen_kw_only = True
        text = p.name
        if kind == "variadic positional":
            text = "*" + text
            seen_kw_only = True
        elif kind == "variadic keyword":
            text = "**" + text
        if p.annotation is not None:
            text += f": {annotation(p.annotation)}"
        if p.default is not None and kind not in ("variadic positional", "variadic keyword"):
            text += f" = {p.default}" if p.annotation is not None else f"={p.default}"
        parts.append(text)
    head = f"{obj.name}({', '.join(parts)})"
    if len(head) > 80 and parts:
        head = f"{obj.name}(\n" + "".join(f"    {part},\n" for part in parts) + ")"
    if obj.is_function and obj.returns is not None:
        head += f" -> {annotation(obj.returns)}"
    return ("class " if obj.is_class else "def ") + head


def _init_parameters(cls):
    init = cls.members.get("__init__")
    if init is not None and not init.is_alias and init.is_function:
        return init.parameters
    return []


def bullet(label: str, description: str | None) -> str:
    """A list item whose description keeps its own paragraphs and lists."""
    if not description:
        return f"- {label}"
    lines = prose(description).splitlines()
    rest = "\n".join(("  " + line) if line.strip() else "" for line in lines[1:])
    return f"- {label}: {lines[0]}" + (f"\n{rest}" if rest else "")


def render_docstring(obj) -> str:
    if not obj.docstring:
        return ""
    blocks: list[str] = []
    for section in obj.docstring.parsed:
        kind = section.kind.value
        if kind == "text":
            blocks.append(prose(section.value))
        elif kind in ("parameters", "other parameters", "attributes"):
            title = {"parameters": "Parameters", "other parameters": "Other parameters",
                     "attributes": "Attributes"}[kind]
            items = []
            for p in section.value:
                kind_text = annotation(p.annotation)
                default = getattr(p, "default", None)
                if default not in (None, "") and not p.name.startswith("*"):
                    kind_text = f"{kind_text}, default {default}" if kind_text else f"default {default}"
                type_part = f" ({inline(kind_text)})" if kind_text else ""
                items.append(bullet(f"**`{p.name}`**{type_part}", p.description))
            blocks.append(f"**{title}**\n\n" + "\n".join(items))
        elif kind in ("returns", "yields", "raises", "warns", "receives"):
            title = kind.capitalize()
            items = []
            for r in section.value:
                name = getattr(r, "name", "") or ""
                kind_text = annotation(r.annotation)
                label = f"`{name}` ({inline(kind_text)})" if name and kind_text else (
                    f"`{kind_text}`" if kind_text else f"`{name}`")
                items.append(bullet(label, r.description))
            blocks.append(f"**{title}**\n\n" + "\n".join(items))
        elif kind == "examples":
            parts = []
            for sub_kind, text in section.value:
                if sub_kind.value == "examples":
                    parts.append("```python\n" + text.strip() + "\n```")
                else:
                    parts.append(prose(text))
            blocks.append("**Examples**\n\n" + "\n\n".join(parts))
        elif kind == "admonition":
            title = section.title or "Note"
            blocks.append(f"**{title}**\n\n" + prose(section.value.description))
        elif kind == "deprecated":
            blocks.append(f"**Deprecated** {section.value.version}: " + prose(section.value.description))
        else:
            value = section.value if isinstance(section.value, str) else str(section.value)
            blocks.append(prose(value))
    return "\n\n".join(b for b in blocks if b.strip())


def public(name: str) -> bool:
    return not name.startswith("_")


def member_block(obj, level: int) -> str:
    """One documented object: its signature, bases and docstring."""
    hashes = "#" * min(level, 6)
    if obj.is_attribute:
        label = "property" if "property" in obj.labels else "attribute"
        head = f"{hashes} `{obj.name}` <span class=\"api-kind\">{label}</span>"
        sig = f"{obj.name}: {annotation(obj.annotation)}" if obj.annotation is not None else obj.name
        body = [head, "", "```python", sig, "```"]
    else:
        label = "class" if obj.is_class else ("method" if obj.parent and obj.parent.is_class else "function")
        if obj.is_function and "property" in obj.labels:
            label = "property"
        head = f"{hashes} `{obj.name}` <span class=\"api-kind\">{label}</span>"
        body = [head, "", "```python", signature(obj), "```"]
        if obj.is_class and obj.bases:
            body += ["", "Bases: " + ", ".join(f"`{annotation(b)}`" for b in obj.bases)]
    doc = render_docstring(obj)
    if doc:
        body += ["", doc]
    return "\n".join(body)


def documented_members(container, undoc: bool):
    names = None
    if container.is_module and container.exports:
        names = [str(n) for n in container.exports]
    for name, member in container.members.items():
        if member.is_alias:
            continue
        if names is not None and name not in names:
            continue
        if not public(name):
            continue
        if member.is_attribute and not member.docstring:
            continue
        if not undoc and not member.docstring:
            continue
        yield member


def render_class(cls, undoc: bool, level: int) -> str:
    parts = [member_block(cls, level)]
    for member in documented_members(cls, undoc):
        if member.is_class:
            parts.append(render_class(member, undoc, level + 1))
        else:
            parts.append(member_block(member, level + 1))
    return "\n\n".join(parts)


def definitions(module, name: str):
    """Every object called ``name`` defined (not imported) anywhere below ``module``."""
    for member in module.members.values():
        if member.is_alias:
            continue
        if member.name == name and (member.is_class or member.is_function):
            yield member
        if member.is_module:
            yield from definitions(member, name)


def lookup(pkg, target: str):
    """Find a dotted target, including names the package exports lazily.

    A name exported through a module-level ``__getattr__`` has no static
    binding, so it is found where it is defined, provided that is unambiguous.
    """
    path = target.split(".", 1)[1] if "." in target else ""
    try:
        obj = pkg[path] if path else pkg
    except KeyError:
        owner, _, name = target.rpartition(".")
        exported = [str(n) for n in (pkg[owner.split(".", 1)[1]] if "." in owner else pkg).exports or []]
        found = list(definitions(pkg, name)) if name in exported else []
        if len(found) != 1:
            raise SystemExit(f"cannot find {target} in the package source")
        obj = found[0]
    return obj.final_target if obj.is_alias else obj


def render_directive(pkg, directive: dict) -> str:
    target = directive["target"]
    options = directive["options"]
    undoc = "no-undoc-members" not in options  # the docs' conf.py turns undoc-members on
    obj = lookup(pkg, target)
    if directive["kind"] == "automodule":
        parts = [f"#### `{target}`"]
        doc = render_docstring(obj)
        if doc:
            parts.append(doc)
        for member in documented_members(obj, undoc):
            if member.is_class:
                parts.append(render_class(member, undoc, 5))
            else:
                parts.append(member_block(member, 5))
        return "\n\n".join(parts)
    if directive["kind"] == "autoclass":
        return render_class(obj, undoc, 5)
    return member_block(obj, 5)


def main() -> None:
    request = json.load(sys.stdin)
    pkg = griffe.load(
        "fastmdxplora",
        search_paths=[request["src"]],
        docstring_parser="numpy",
        allow_inspection=False,
        resolve_aliases=False,
    )
    rendered = []
    for block in request["blocks"]:
        directives = parse_directives(block)
        if not directives:
            raise SystemExit(f"eval-rst block with no autodoc directive:\n{block}")
        rendered.append("\n\n".join(
            '<div class="api-object">\n\n' + render_directive(pkg, d) + '\n\n</div>' for d in directives))
    json.dump({"blocks": rendered}, sys.stdout)


if __name__ == "__main__":
    main()
