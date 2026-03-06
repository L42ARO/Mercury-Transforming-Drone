# blueprints/pages.py
import os
from flask import Blueprint, render_template, abort
from jinja2 import TemplateNotFound

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
ASSETS_DIR = os.path.join(TEMPLATES_DIR, "assets")

bp = Blueprint(
    "pages",
    __name__,
    template_folder=TEMPLATES_DIR,
    static_folder=ASSETS_DIR,
    static_url_path="/assets",
)


@bp.route("/")
def index():
    return render_template("index.html")


@bp.route("/<path:page>")
def render_page(page: str):
    """
    SPA fallback routing:
    - If page ends with .html and exists → render it.
    - Otherwise → always return index.html so React Router can handle the route.
    """
    if page.endswith(".html"):
        try:
            return render_template(page)
        except TemplateNotFound:
            abort(404)

    return render_template("index.html")
