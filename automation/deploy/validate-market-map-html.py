from html.parser import HTMLParser
import hmac
import os
import pathlib
import re
import stat
import sys


LEAFLET_SCRIPT = "./vendor/leaflet.js"
LEAFLET_STYLESHEET = "./vendor/leaflet.css"
YANDEX_KEY_PLACEHOLDER = "__TENCORP_YANDEX_MAPS_API_KEY__"
YANDEX_SCRIPT = re.compile(
    r"https://api-maps\.yandex\.ru/2\.1/\?"
    r"(?:apikey=([A-Za-z0-9_-]{8,256})&lang=ru_RU|lang=ru_RU&apikey=([A-Za-z0-9_-]{8,256}))\Z"
)
INERT_OR_FOREIGN_CONTEXTS = {
    "template", "noscript", "svg", "math",
    "title", "textarea", "style", "xmp", "noembed", "noframes",
}
FORBIDDEN_EXECUTABLE_TAGS = {"iframe", "object", "embed"}
FORBIDDEN_PARSER_CONTEXTS = {"plaintext", "frameset", "frame"}
MAX_HTML_BYTES = 5 * 1024 * 1024
MAX_TAGS = 10_000
MAX_ATTRIBUTES_PER_TAG = 32
MAX_INLINE_SCRIPTS = 8
MAX_INLINE_SCRIPT_BYTES = 2 * 1024 * 1024
CANONICAL_MARKUP_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]*\Z")
HTML_WHITESPACE = " \t\n\f\r"
VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


def fail(message):
    raise SystemExit(message)


class MapProviderParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.has_html = False
        self.html_open = False
        self.html_closed = False
        self.head_seen = False
        self.head_open = False
        self.body_seen = False
        self.body_open = False
        self.script_sources = []
        self.script_raw_sources = []
        self.script_raw_placeholder_counts = []
        self.stylesheet_sources = []
        self.stylesheet_raw_sources = []
        self.blocked_contexts = []
        self.inline_scripts = []
        self.current_script_data = None
        self.current_script_external = False
        self.open_script = False
        self.tag_count = 0

    @staticmethod
    def raw_attribute_value(raw_start_tag, name):
        pattern = re.compile(
            rf"(?:[{HTML_WHITESPACE}]){re.escape(name)}[{HTML_WHITESPACE}]*="
            rf"[{HTML_WHITESPACE}]*(?:\"([^\"]*)\"|'([^']*)')",
            re.IGNORECASE,
        )
        matches = pattern.findall(raw_start_tag)
        if len(matches) != 1:
            return None
        return matches[0][0] or matches[0][1]

    @staticmethod
    def attributes_for(tag, attrs):
        if len(attrs) > MAX_ATTRIBUTES_PER_TAG:
            fail(f"market-map HTML has too many attributes on {tag}")
        names = set()
        values = {}
        for raw_name, raw_value in attrs:
            if raw_name is None:
                fail(f"market-map HTML has a malformed {tag} attribute")
            if not raw_name.isascii() or re.fullmatch(r"[A-Za-z_:][A-Za-z0-9_.:-]*", raw_name) is None:
                fail(f"market-map HTML has a non-canonical attribute name on {tag}")
            name = raw_name.lower()
            if name in names:
                fail(f"market-map HTML has a duplicate {name} attribute on {tag}")
            names.add(name)
            values[name] = raw_value
        return values

    def handle_starttag(self, tag, attrs):
        self.tag_count += 1
        if self.tag_count > MAX_TAGS:
            fail("market-map HTML contains too many elements")
        normalized_tag = tag.lower()
        raw_start_tag = self.get_starttag_text()
        raw_tag_match = re.match(r"<([A-Za-z][^\t\n\r\f />]*)", raw_start_tag)
        if raw_tag_match is None:
            fail("market-map HTML contains a malformed raw start tag")
        raw_tag = raw_tag_match.group(1)
        if (not raw_tag.isascii() or CANONICAL_MARKUP_NAME.fullmatch(raw_tag) is None
                or raw_tag.lower() != normalized_tag):
            fail("market-map HTML contains a non-canonical raw markup name")
        if normalized_tag in {"script", "link"} and any(
                character.isspace() and character not in " \t\n\f\r"
                for character in raw_start_tag
        ):
            fail(f"market-map {normalized_tag} tag contains non-HTML whitespace")
        if normalized_tag == "html":
            if self.has_html or self.head_seen or self.body_seen or self.html_closed:
                fail("market-map HTML must contain one canonical root element")
            self.has_html = True
            self.html_open = True
            return
        if not self.html_open or self.html_closed:
            fail("market-map HTML content must stay inside its canonical root element")
        if normalized_tag == "head":
            if self.head_seen or self.head_open or self.body_seen or self.blocked_contexts:
                fail("market-map HTML head must be the first element inside the root")
            self.head_seen = True
            self.head_open = True
            return
        if not self.head_seen:
            fail("market-map HTML head must be the first element inside the root")
        if normalized_tag == "body":
            if self.head_open or self.body_seen or self.body_open or self.blocked_contexts:
                fail("market-map HTML must contain one canonical body after the head")
            self.body_seen = True
            self.body_open = True
            return
        if not self.head_open and not self.body_open:
            fail("market-map HTML content must stay inside the canonical head or body")
        if self.head_open and normalized_tag not in {"meta", "title", "style", "script", "link"}:
            fail(f"market-map HTML head contains an unsupported {normalized_tag} element")
        if normalized_tag == "base":
            fail("market-map HTML must not contain a base URL override")
        if normalized_tag in FORBIDDEN_PARSER_CONTEXTS:
            fail(f"market-map HTML must not contain the parser-changing {normalized_tag} element")
        if normalized_tag in FORBIDDEN_EXECUTABLE_TAGS:
            fail(f"market-map HTML must not contain an executable {normalized_tag} element")
        if normalized_tag in INERT_OR_FOREIGN_CONTEXTS:
            self.blocked_contexts.append(normalized_tag)
            return
        if normalized_tag not in {"script", "link"}:
            return
        attributes = self.attributes_for(normalized_tag, attrs)
        if normalized_tag == "script":
            if self.blocked_contexts:
                fail("market-map script elements must be executable in the main HTML document")
            if self.open_script:
                fail("market-map HTML must not nest script elements")
            self.open_script = True
            self.current_script_data = []
            self.current_script_external = "src" in attributes
            if "href" in attributes or "xlink:href" in attributes:
                fail("market-map script tags must not use alternate external-source attributes")
            if "src" in attributes:
                if not self.head_open:
                    fail("market-map provider scripts must be direct resources of the reviewed head")
                source = attributes["src"] or ""
                if source != source.strip():
                    fail("market-map script source must not contain surrounding whitespace")
                if set(attributes) - {"src", "type"}:
                    fail("market-map provider script has unsupported execution attributes")
                script_type = attributes.get("type")
                if script_type is not None and script_type != "text/javascript":
                    fail("market-map provider script must use the classic JavaScript type")
                self.script_sources.append(source)
                self.script_raw_sources.append(
                    self.raw_attribute_value(self.get_starttag_text(), "src")
                )
                self.script_raw_placeholder_counts.append(
                    self.get_starttag_text().count(YANDEX_KEY_PLACEHOLDER)
                )
            else:
                if set(attributes) - {"type"}:
                    fail("market-map inline script has unsupported execution attributes")
                script_type = attributes.get("type")
                if script_type == "module":
                    fail("market-map inline module scripts are outside the reviewed runtime contract")
                if script_type not in {None, "text/javascript", "application/javascript"}:
                    fail("market-map inline script type is outside the reviewed runtime contract")
            return
        if "href" not in attributes:
            return
        if not self.head_open:
            fail("market-map provider stylesheet must be a direct resource of the reviewed head")
        href = attributes["href"] or ""
        rel = attributes.get("rel")
        if href != LEAFLET_STYLESHEET or rel != "stylesheet":
            fail("market-map HTML loads an unapproved linked resource")
        if self.blocked_contexts:
            fail("market-map provider stylesheet must apply in the main document context")
        if set(attributes) - {"href", "rel", "type"}:
            fail("market-map provider stylesheet has unsupported loading attributes")
        stylesheet_type = attributes.get("type")
        if stylesheet_type is not None and stylesheet_type != "text/css":
            fail("market-map provider stylesheet must use the CSS type")
        self.stylesheet_sources.append(href)
        self.stylesheet_raw_sources.append(
            self.raw_attribute_value(self.get_starttag_text(), "href")
        )

    def handle_endtag(self, tag):
        normalized_tag = tag.lower()
        if normalized_tag == "html":
            if not self.html_open or self.head_open or self.body_open or not self.body_seen:
                fail("market-map HTML has an ambiguous root boundary")
            self.html_open = False
            self.html_closed = True
            return
        if not self.html_open or self.html_closed:
            fail("market-map HTML end tags must stay inside the canonical root element")
        if normalized_tag == "head":
            if not self.head_open or self.blocked_contexts or self.open_script:
                fail("market-map HTML has an ambiguous head boundary")
            self.head_open = False
            return
        if normalized_tag == "body":
            if not self.body_open or self.head_open or self.blocked_contexts or self.open_script:
                fail("market-map HTML has an ambiguous body boundary")
            self.body_open = False
            return
        if normalized_tag == "script":
            if not self.open_script:
                fail("market-map HTML has an unmatched script end tag")
            if self.current_script_data is not None:
                source = "".join(self.current_script_data)
                if "<!--" in source or "-->" in source:
                    fail("market-map scripts must not use legacy HTML comment delimiters")
                if not self.current_script_external and source.strip():
                    self.inline_scripts.append(source)
                self.current_script_data = None
                self.current_script_external = False
            self.open_script = False
            return
        if normalized_tag not in INERT_OR_FOREIGN_CONTEXTS:
            return
        if not self.blocked_contexts or self.blocked_contexts[-1] != normalized_tag:
            fail("market-map HTML has malformed inert or foreign-content nesting")
        self.blocked_contexts.pop()

    def handle_startendtag(self, tag, attrs):
        normalized_tag = tag.lower()
        if normalized_tag not in VOID_ELEMENTS:
            fail(f"market-map HTML must not self-close the non-void {normalized_tag} element")
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if self.current_script_data is not None:
            self.current_script_data.append(data)
        elif (not self.html_open or (not self.head_open and not self.body_open)) and data.strip():
            fail("market-map HTML contains content outside its canonical document structure")

    def handle_comment(self, data):
        fail("market-map HTML comments are outside the reviewed document contract")

    def handle_decl(self, decl):
        if self.has_html or decl.lower() != "doctype html":
            fail("market-map HTML declaration is outside the reviewed document contract")

    def handle_pi(self, data):
        fail("market-map HTML processing instructions are outside the reviewed document contract")

    def unknown_decl(self, data):
        fail("market-map HTML declaration is outside the reviewed document contract")


def write_inline_scripts(scripts, directory):
    destination = pathlib.Path(directory)
    try:
        if not destination.is_dir() or destination.is_symlink() or any(destination.iterdir()):
            fail("market-map inline-script destination must be an empty regular directory")
        for index, source in enumerate(scripts, start=1):
            with (destination / f"inline-{index:04d}.js").open("x", encoding="utf-8", newline="") as output:
                output.write(source)
    except OSError as error:
        fail(f"market-map inline scripts could not be exported safely: {error.strerror}")


def validate(filename, expected_api_key=None, inline_directory=None):
    html_path = pathlib.Path(filename)
    try:
        if html_path.stat().st_size > MAX_HTML_BYTES:
            fail("market-map HTML exceeds the reviewed size limit")
        html = html_path.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"market-map HTML is unavailable: {error.strerror}")
    if any(character.isspace() and character not in HTML_WHITESPACE for character in html):
        fail("market-map HTML contains non-HTML whitespace; use an explicit entity in text content")
    if re.search(rf"</[{HTML_WHITESPACE}]+", html):
        fail("market-map HTML contains a non-canonical end tag")
    parser = MapProviderParser()
    try:
        parser.feed(html)
        parser.close()
    except (UnicodeError, ValueError) as error:
        fail(f"market-map HTML cannot be parsed safely: {error}")
    if (not parser.has_html or parser.html_open or not parser.html_closed
            or not parser.head_seen or parser.head_open
            or not parser.body_seen or parser.body_open):
        fail("market-map HTML entrypoint is incomplete")
    if parser.blocked_contexts:
        fail("market-map HTML has an unclosed inert or foreign-content context")
    if parser.open_script or parser.current_script_data is not None:
        fail("market-map HTML has an unclosed script element")
    if not 1 <= len(parser.inline_scripts) <= MAX_INLINE_SCRIPTS:
        fail("market-map HTML must contain between one and eight executable inline scripts")
    if sum(len(source.encode("utf-8")) for source in parser.inline_scripts) > MAX_INLINE_SCRIPT_BYTES:
        fail("market-map inline JavaScript exceeds the reviewed size limit")

    leaflet_scripts = [source for source in parser.script_sources if source == LEAFLET_SCRIPT]
    yandex_scripts = []
    for source, raw_source, raw_placeholder_count in zip(
        parser.script_sources, parser.script_raw_sources, parser.script_raw_placeholder_counts
    ):
        if source == LEAFLET_SCRIPT:
            if raw_source != LEAFLET_SCRIPT:
                fail("market-map Leaflet script source must use its literal pinned path")
            continue
        match = YANDEX_SCRIPT.fullmatch(source)
        if match is not None:
            api_key = match.group(1) or match.group(2)
            canonical_raw_sources = {
                f"https://api-maps.yandex.ru/2.1/?apikey={api_key}&amp;lang=ru_RU",
                f"https://api-maps.yandex.ru/2.1/?lang=ru_RU&amp;apikey={api_key}",
            }
            if raw_source not in canonical_raw_sources:
                fail("market-map Yandex Maps source must use a literal URL with canonical &amp; separation")
            if expected_api_key is None and api_key != YANDEX_KEY_PLACEHOLDER:
                fail("market-map source must use the operator-owned Yandex Maps API key placeholder")
            if expected_api_key is None and raw_placeholder_count != 1:
                fail("market-map source must use one literal Yandex Maps API key placeholder in the provider tag")
            if expected_api_key is not None and not hmac.compare_digest(api_key, expected_api_key):
                fail("market-map rendered Yandex Maps API key does not match the operator-owned key")
            yandex_scripts.append(source)
            continue
        if source.startswith("https://api-maps.yandex.ru/"):
            if "apikey=" not in source:
                fail("market-map Yandex Maps API key placeholder is missing")
            fail("market-map Yandex Maps URL must use the approved API 2.1 endpoint with apikey and lang=ru_RU")
        fail(f"market-map HTML loads an unapproved script: {source or '(empty)'}")

    uses_leaflet = bool(leaflet_scripts or parser.stylesheet_sources)
    uses_yandex = bool(yandex_scripts)
    if uses_leaflet and uses_yandex:
        fail("market-map HTML must not mix Leaflet and Yandex Maps providers")
    if uses_leaflet:
        if len(leaflet_scripts) != 1 or len(parser.stylesheet_sources) != 1:
            fail("market-map Leaflet HTML must load each pinned local asset exactly once")
        if parser.stylesheet_raw_sources != [LEAFLET_STYLESHEET]:
            fail("market-map Leaflet stylesheet must use its literal pinned path")
        provider = "leaflet"
    elif uses_yandex:
        if len(yandex_scripts) != 1:
            fail("market-map HTML must load the approved Yandex Maps script exactly once")
        if expected_api_key is None and html.count(YANDEX_KEY_PLACEHOLDER) != 1:
            fail("market-map source must contain exactly one literal Yandex Maps API key placeholder")
        provider = "yandex-maps-js-2.1"
    else:
        fail("market-map HTML must use one approved map provider")
    if inline_directory is not None:
        write_inline_scripts(parser.inline_scripts, inline_directory)
    return provider


def read_operator_api_key(filename, required_owner_uid=0):
    path = pathlib.Path(filename)
    descriptor = None
    try:
        if not path.is_absolute() or path.parent.resolve(strict=True) != path.parent:
            fail("operator-owned Yandex Maps API key path is not canonical")
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            fail("operator-owned Yandex Maps API key file is not a regular file")
        if metadata.st_uid != required_owner_uid or metadata.st_mode & 0o777 != 0o600:
            fail("operator-owned Yandex Maps API key file must be root-owned with mode 0600")
        raw = os.read(descriptor, 513)
    except OSError as error:
        fail(f"operator-owned Yandex Maps API key file is unavailable: {error.strerror}")
    finally:
        if descriptor is not None:
            os.close(descriptor)
    if len(raw) > 512:
        fail("operator-owned Yandex Maps API key file is unexpectedly large")
    try:
        api_key = raw.decode("ascii").strip()
    except UnicodeDecodeError:
        fail("operator-owned Yandex Maps API key must be ASCII")
    if api_key == YANDEX_KEY_PLACEHOLDER or re.fullmatch(r"[A-Za-z0-9_-]{8,256}", api_key) is None:
        fail("operator-owned Yandex Maps API key is missing or invalid")
    return api_key


def render(source_filename, destination_filename, api_key_filename, required_owner_uid=0):
    provider = validate(source_filename)
    html = pathlib.Path(source_filename).read_text(encoding="utf-8")
    if provider == "yandex-maps-js-2.1":
        if html.count(YANDEX_KEY_PLACEHOLDER) != 1:
            fail("market-map source must contain exactly one Yandex Maps API key placeholder")
        api_key = read_operator_api_key(api_key_filename, required_owner_uid=required_owner_uid)
        html = html.replace(YANDEX_KEY_PLACEHOLDER, api_key)
        temporary = pathlib.Path(destination_filename)
        with temporary.open("x", encoding="utf-8", newline="") as destination:
            destination.write(html)
        validate(temporary, expected_api_key=api_key)
        return provider
    with pathlib.Path(destination_filename).open("x", encoding="utf-8", newline="") as destination:
        destination.write(html)
    return provider


def main(argv):
    if len(argv) == 2:
        provider = validate(argv[1])
    elif len(argv) == 4 and argv[1] == "--extract-inline":
        provider = validate(argv[2], inline_directory=argv[3])
    elif len(argv) == 5 and argv[1] == "--render":
        provider = render(argv[2], argv[3], argv[4])
    elif len(argv) == 3 and argv[1] == "--check-key":
        read_operator_api_key(argv[2])
        provider = "yandex-key-present"
    else:
        fail("usage: validate-market-map-html.py HTML_FILE | --extract-inline HTML_FILE DIRECTORY | --render SOURCE DESTINATION API_KEY_FILE | --check-key API_KEY_FILE")
    print(provider)


if __name__ == "__main__":
    main(sys.argv)
