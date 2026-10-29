---
name: shopify-theme
description: Building and changing Shopify Online Store 2.0 themes - Liquid, sections, theme blocks, snippets, JSON templates, settings schema, assets and locales - with Shopify CLI theme dev/pull/push and Theme Check. Use for any storefront look-and-feel change, new section, product or collection page change, or theme bug.
---

# Shopify themes

## When to Use

- Adding or changing a section, block, snippet, template or theme setting.
- Showing product or metafield data on the storefront.
- Theme performance, accessibility or layout bugs.
- Pulling, previewing or pushing a theme.

## How It Works

### Theme layout

```text
layout/      theme.liquid (wraps every page), password.liquid
templates/   *.json (OS 2.0: list of sections + settings), customers/, gift_card.liquid
sections/    reusable page sections with {% schema %}; section groups (header/footer) as *.json
blocks/      theme blocks usable inside sections that accept "@theme" blocks
snippets/    partials rendered with {% render 'name', var: value %}
assets/      CSS, JS, images (use asset_url)
config/      settings_schema.json (theme settings), settings_data.json (saved values)
locales/     en.default.json, *.schema.json (editor labels)
```

### Safe workflow

1. `shopify theme pull --store <store> --theme <id>` to start from what is on the store
   (theme editor changes live only there).
2. `shopify theme dev --store <store>` for a local preview with hot reload.
3. `shopify theme check` — fix errors in files you touched.
4. Share with `shopify theme push --unpublished` (new unpublished theme) or `--theme <id>`
   (existing unpublished theme). Get feedback on the preview link.
5. Going live is a separate, explicit decision by the user. The MySoftware hook blocks
   `theme publish`, `push --live` and `push --allow-live` until they say yes.

**Editor changes get overwritten.** `templates/*.json`, section group `*.json` and
`config/settings_data.json` hold customisations made in the theme editor. A push replaces
them. Pull first, or push with `--ignore 'templates/*.json' --ignore config/settings_data.json`
when you only changed Liquid/CSS/JS. Use `--only` to push specific files.

### Liquid rules

- `{% render %}` (isolated scope, pass variables explicitly), never `{% include %}`.
- Escape user-controlled output: `{{ search.terms | escape }}`.
- Images: `{{ image | image_url: width: 800 | image_tag: loading: 'lazy', widths: '400, 800, 1200', sizes: '(min-width: 990px) 50vw, 100vw' }}`.
- Money: `{{ product.price | money }}` — never format prices by hand.
- Metafields: `{{ product.metafields.custom.size_chart.value }}`; always handle `blank`.
- Translatable strings: `{{ 'sections.size_chart.title' | t }}` with keys in `locales/`.
- Avoid heavy loops (`collections.all.products`), deep nesting, and `| json` dumps in output.
- JavaScript: small, deferred (`<script src="{{ 'x.js' | asset_url }}" defer></script>`),
  progressive enhancement; no new frameworks for small widgets.

### Section schema checklist

- Valid JSON; unique setting `id`s; `type`s that exist (`text`, `richtext`, `image_picker`,
  `color`, `range`, `select`, `checkbox`, `url`, `product`, `collection`, …).
- `presets` so it can be added in the editor; `blocks` with `max_blocks` where sensible.
- Labels as `t:` keys if the theme uses schema translations.
- Merchant-editable text, images and colours are settings, not hard-coded.

### Look things up

Use the Shopify Dev MCP tools to search Liquid docs, check objects/filters, and validate theme
files. Liquid objects and theme features change; don't guess filter names.

## Examples

### Size chart section reading a metafield

```liquid
{%- comment -%} sections/size-chart.liquid {%- endcomment -%}
{%- assign chart = product.metafields.custom.size_chart.value -%}
{%- if chart != blank -%}
  <details class="size-chart">
    <summary>{{ section.settings.heading | escape }}</summary>
    <div class="rte">{{ chart }}</div>
  </details>
{%- endif -%}

{% schema %}
{
  "name": "Size chart",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Size chart" }
  ],
  "enabled_on": { "templates": ["product"] },
  "presets": [{ "name": "Size chart" }]
}
{% endschema %}
```

### Push only changed Liquid and CSS to an unpublished theme

```bash
shopify theme push --theme 123456789 --store our-store.myshopify.com \
  --only sections/size-chart.liquid --only assets/size-chart.css
```
