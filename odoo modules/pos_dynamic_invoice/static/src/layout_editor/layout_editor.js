/** @odoo-module **/

import { Component, useState, useRef, onWillStart, useEffect, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { useSortable } from "@web/core/utils/sortable_owl";

const BLOCK_LABELS = {
    logo: "Logo",
    company_name_en: "Company Name (English)",
    company_name_ar: "Company Name (Arabic)",
    header_info: "Company Header",
    title: "Title",
    meta_fields: "Order Fields (No / Date / Customer)",
    items_table: "Items Table",
    totals: "Totals",
    payments: "Payments",
    customer_due: "Customer Due",
    signatures: "Signatures",
    footer: "Footer",
    barcode: "Barcode",
    qrcode: "QR Code",
    custom_text: "Custom Text",
};

const ADDABLE = [
    "custom_text", "logo", "company_name_en", "company_name_ar", "header_info",
    "title", "meta_fields", "items_table", "totals", "payments", "customer_due",
    "signatures", "footer", "barcode", "qrcode",
];

const BLOCK_FIELDS = [
    "block_type", "row", "col", "width_pct", "visible", "align", "direction",
    "font_size_px", "bold", "label_en", "label_ar", "logo_width_pct",
    "content_en", "content_ar", "grid_x", "grid_y", "grid_w", "grid_h",
    "qr_data", "barcode_field",
];

const SCALE = 3;         // px per mm
const CELL_MM = 10;      // 1 cm
const CELL_PX = CELL_MM * SCALE; // px per cm square = 30

// Visual layout editor. Two modes:
//  - flow: stacked section list (drag-reorder, resize width).
//  - grid: Softify-style 1cm-square canvas — click a box, drag to snap, resize
//    by squares; auto-saved. Written defensively so nothing white-screens.
export class LayoutEditor extends Component {
    static template = "pos_dynamic_invoice.LayoutEditor";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        const act = this.props.action || {};
        const ctx = act.context || {};
        const params = act.params || {};
        this.layoutId = ctx.layout_id || params.layout_id;

        this.state = useState({
            layoutName: "",
            widthMm: 80,
            positioning: "flow",
            canvasHcm: 40,
            blocks: [],
            header: {},
            selectedId: null,
            loading: true,
            error: "",
            resizingId: null,
            resizeMm: 0,
            pwrapW: 420, // measured preview-panel width, for fit-to-width scaling
            previewContentH: 900, // measured receipt content height (fits the paper)
            headerFields: [], // editable/reorderable Company Header rows
        });

        this.listRef = useRef("list");
        this.iframeRef = useRef("iframe");
        this.pwrapRef = useRef("pwrap");
        this.previewHtml = "";
        this._resize = null; // flow width resize
        this._drag = null;   // grid move/resize
        this.undoStack = [];
        this.redoStack = [];
        this._onResize = () => this._measurePreview();

        onWillStart(async () => {
            await this.load();
        });

        onMounted(() => {
            this._measurePreview();
            window.addEventListener("resize", this._onResize);
        });
        onWillUnmount(() => {
            window.removeEventListener("resize", this._onResize);
        });

        // Flow mode: drag to reorder the list.
        useSortable({
            ref: this.listRef,
            elements: ".pdi-block",
            handle: ".pdi-handle",
            cursor: "grabbing",
            onDrop: () => this.persistOrder(),
        });

        useEffect(
            () => {
                const el = this.iframeRef.el;
                if (el && this.previewHtml) {
                    try {
                        const doc = el.contentDocument;
                        doc.open();
                        doc.write(this.previewHtml);
                        doc.close();
                        // Fit the preview paper to its actual content height so no
                        // empty white space is left below the footer. body.scrollHeight
                        // (not documentElement) = content height, which SHRINKS below
                        // the iframe's own height — the paper hugs the content.
                        const measure = () => {
                            try {
                                const h = (doc.body && doc.body.scrollHeight) || 0;
                                if (h > 40) { this.state.previewContentH = h + 16; }
                            } catch (e) { /* iframe torn down */ }
                        };
                        measure();
                        // Re-measure once late-loading images (logo, signatures)
                        // arrive, otherwise the first measure is too short.
                        const imgs = (doc.images && [...doc.images]) || [];
                        for (const img of imgs) {
                            if (!img.complete) {
                                img.addEventListener("load", measure, { once: true });
                                img.addEventListener("error", measure, { once: true });
                            }
                        }
                    } catch (e) {
                        // ignore transient iframe races
                    }
                }
            },
            () => [this.previewHtml, this.state.blocks.length, this.state.selectedId, this.state.positioning]
        );
    }

    async load() {
        try {
            if (!this.layoutId) {
                this.state.error = "No layout selected. Open a layout, then the editor.";
                this.state.loading = false;
                return;
            }
            const [layout] = await this.orm.read(
                "pos.invoice.layout", [this.layoutId],
                ["name", "paper_size_id", "positioning", "canvas_h_cm"]
            );
            if (layout) {
                this.state.layoutName = layout.name || "";
                this.state.positioning = layout.positioning || "flow";
                this.state.canvasHcm = layout.canvas_h_cm || 40;
                if (layout.paper_size_id) {
                    const [size] = await this.orm.read(
                        "pos.invoice.paper.size", [layout.paper_size_id[0]], ["width_mm"]
                    );
                    this.state.widthMm = (size && size.width_mm) || 80;
                }
            }
            this.state.blocks = await this.orm.searchRead(
                "pos.invoice.layout.block",
                [["layout_id", "=", this.layoutId]],
                BLOCK_FIELDS,
                { order: "row, col, id" }
            );
            try {
                this.state.header = await this.orm.call(
                    "pos.invoice.layout", "header_settings", [[this.layoutId]]);
            } catch (e) { this.state.header = {}; }
            await this.loadHeaderFields();
            this.state.error = "";
            await this.refreshPreview();
        } catch (e) {
            this.state.error = (e && e.message) || String(e);
        } finally {
            this.state.loading = false;
        }
    }

    // ---- helpers ----
    label(block) { return BLOCK_LABELS[block.block_type] || block.block_type; }
    get addableOptions() { return ADDABLE.map((t) => ({ value: t, label: BLOCK_LABELS[t] })); }
    get selected() { return this.state.blocks.find((b) => b.id === this.state.selectedId) || null; }
    get isGrid() { return this.state.positioning === "grid"; }
    get canvasPx() { return Math.max(120, Math.round(this.state.widthMm * SCALE)); }
    // Canvas height FITS the content: extend to the lowest block + 1cm breathing
    // room, so moving the footer down grows the canvas and no waste space is left.
    get gridHpx() {
        let maxBottom = 6;
        for (const b of this.state.blocks) {
            const bottom = (b.grid_y || 0) + (b.grid_h || 2);
            if (bottom > maxBottom) { maxBottom = bottom; }
        }
        return Math.round((maxBottom + 1) * CELL_PX);
    }
    get ruler() {
        const ticks = [];
        for (let mm = 0; mm <= this.state.widthMm; mm += 10) {
            ticks.push({ mm, px: mm * SCALE, major: mm % 20 === 0 });
        }
        return ticks;
    }
    widthPx(block) {
        const pct = Math.min(100, Math.max(1, block.width_pct || 100));
        return Math.round((pct / 100) * this.canvasPx);
    }
    widthMmOf(block) {
        const pct = Math.min(100, Math.max(1, block.width_pct || 100));
        return Math.round((pct / 100) * this.state.widthMm);
    }
    // grid geometry (px)
    gLeft(b) { return (b.grid_x || 0) * CELL_PX; }
    gTop(b) { return (b.grid_y || 0) * CELL_PX; }
    gW(b) { return (b.grid_w || 4) * CELL_PX; }
    gH(b) { return (b.grid_h || 2) * CELL_PX; }

    select(id) { this.state.selectedId = id; }

    // ---- preview fit-to-width ----
    _measurePreview() {
        const el = this.pwrapRef && this.pwrapRef.el;
        if (el && el.clientWidth) {
            this.state.pwrapW = el.clientWidth;
        }
    }
    // Browser renders CSS mm at 96dpi = 3.7795 px/mm — the receipt's true width.
    get previewNaturalPx() {
        return Math.max(120, Math.round(this.state.widthMm * (96 / 25.4)));
    }
    // ONE scale for all sizes, set so the widest paper (~A4, 220mm) fills the
    // panel. Narrower papers then appear proportionally narrower (real size),
    // centered — a 4" reads narrow, A4 reads wide, and nothing h-scrolls.
    get previewScale() {
        const refPx = 220 * (96 / 25.4); // A4-ish reference width
        const s = (this.state.pwrapW - 12) / refPx;
        return Math.max(0.15, Math.min(1.5, s || 1));
    }
    get previewScaledW() { return Math.round(this.previewNaturalPx * this.previewScale); }
    get previewScaledH() { return Math.round(this.state.previewContentH * this.previewScale); }

    // ---- undo / redo (snapshot of block fields) ----
    _snapFields() {
        return ["row", "col", "width_pct", "visible", "align", "direction",
            "font_size_px", "bold", "label_en", "content_en", "content_ar",
            "grid_x", "grid_y", "grid_w", "grid_h"];
    }
    snapshot() {
        const f = this._snapFields();
        return this.state.blocks.map((b) => {
            const o = { id: b.id };
            for (const k of f) { o[k] = b[k]; }
            return o;
        });
    }
    pushHistory() {
        this.undoStack.push(this.snapshot());
        if (this.undoStack.length > 60) { this.undoStack.shift(); }
        this.redoStack = [];
        this.state.histTick = (this.state.histTick || 0) + 1;
    }
    async _applySnapshot(snap) {
        const f = this._snapFields();
        for (const s of snap) {
            const cur = this.state.blocks.find((b) => b.id === s.id);
            if (!cur) { continue; }
            const vals = {};
            for (const k of f) { if (s[k] !== cur[k]) { vals[k] = s[k]; } }
            if (Object.keys(vals).length) {
                await this.orm.write("pos.invoice.layout.block", [s.id], vals);
            }
        }
        await this.load();
    }
    async undo() {
        if (!this.undoStack.length) { return; }
        this.redoStack.push(this.snapshot());
        await this._applySnapshot(this.undoStack.pop());
        this.state.histTick = (this.state.histTick || 0) + 1;
    }
    async redo() {
        if (!this.redoStack.length) { return; }
        this.undoStack.push(this.snapshot());
        await this._applySnapshot(this.redoStack.pop());
        this.state.histTick = (this.state.histTick || 0) + 1;
    }
    get canUndo() { this.state.histTick; return this.undoStack.length > 0; }
    get canRedo() { this.state.histTick; return this.redoStack.length > 0; }

    async toggleMode() {
        try {
            const mode = this.isGrid ? "flow" : "grid";
            await this.orm.call("pos.invoice.layout", "set_positioning", [[this.layoutId], mode]);
            await this.load();
        } catch (e) { this.notify(e); }
    }

    // Explicit Save: every edit already auto-saves, but this gives the user a
    // clear "committed" action — re-flush every block's fields in one batch, then
    // confirm. Reassurance, not a correctness requirement.
    async save() {
        try {
            const fields = ["row", "col", "width_pct", "visible", "align", "direction",
                "font_size_px", "bold", "label_en", "label_ar", "content_en", "content_ar",
                "logo_width_pct", "grid_x", "grid_y", "grid_w", "grid_h"];
            await Promise.all(this.state.blocks.map((b) => {
                const vals = {};
                for (const k of fields) { vals[k] = b[k]; }
                return this.orm.write("pos.invoice.layout.block", [b.id], vals);
            }));
            await this.refreshPreview();
            if (this.notification) {
                this.notification.add(
                    `Layout saved — your ${this.state.widthMm}mm receipts now use this format.`,
                    { type: "success" });
            }
        } catch (e) { this.notify(e); }
    }

    async resetDefault() {
        if (!window.confirm("Reset this size's layout to the clean default? Your current arrangement for this size will be replaced.")) {
            return;
        }
        try {
            this.pushHistory();
            await this.orm.call("pos.invoice.layout", "action_reset_default", [[this.layoutId]]);
            this.state.selectedId = null;
            await this.load();
        } catch (e) { this.notify(e); }
    }

    // ---- persistence ----
    async persistOrder() {
        try {
            const els = [...this.listRef.el.querySelectorAll(".pdi-block")];
            const ids = els.map((el) => parseInt(el.dataset.id, 10));
            await Promise.all(ids.map((id, i) =>
                this.orm.write("pos.invoice.layout.block", [id], { row: i, col: 0 })));
            await this.load();
        } catch (e) { this.notify(e); }
    }

    async setField(id, field, value) {
        try {
            this.pushHistory();
            await this.orm.write("pos.invoice.layout.block", [id], { [field]: value });
            const b = this.state.blocks.find((x) => x.id === id);
            if (b) { b[field] = value; }
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }

    async setFields(id, vals) {
        try {
            await this.orm.write("pos.invoice.layout.block", [id], vals);
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }

    onToggleVisible(block) { return this.setField(block.id, "visible", !block.visible); }
    onToggleBold(block) { return this.setField(block.id, "bold", !block.bold); }
    flipSide(block) {
        const next = (block.align || "auto") === "left" ? "right" : "left";
        return this.setField(block.id, "align", next);
    }

    onPropInput(field, ev) {
        if (!this.selected) { return; }
        let value = ev.target.value;
        if (["width_pct", "font_size_px", "logo_width_pct"].includes(field)) {
            value = parseInt(value || "0", 10) || 0;
        } else if (["grid_x", "grid_y", "grid_w", "grid_h"].includes(field)) {
            value = Math.round((parseFloat(value || "0") || 0) * 4) / 4; // 0.25cm steps
        }
        return this.setField(this.selected.id, field, value);
    }

    // ---- add / remove ----
    async addSection(ev) {
        const type = ev.target.value;
        if (!type) { return; }
        ev.target.value = "";
        try {
            const nextRow = this.state.blocks.length
                ? Math.max(...this.state.blocks.map((b) => b.row)) + 1 : 0;
            const nextY = this.state.blocks.length
                ? Math.max(...this.state.blocks.map((b) => (b.grid_y || 0) + (b.grid_h || 2))) : 0;
            const id = await this.orm.create("pos.invoice.layout.block", [{
                layout_id: this.layoutId, block_type: type, row: nextRow, col: 0,
                width_pct: 100, visible: true,
                grid_x: 0, grid_y: nextY, grid_w: Math.round(this.state.widthMm / 10), grid_h: 2,
            }]);
            await this.load();
            this.state.selectedId = Array.isArray(id) ? id[0] : id;
        } catch (e) { this.notify(e); }
    }

    async removeSection(block) {
        try {
            await this.orm.unlink("pos.invoice.layout.block", [block.id]);
            if (this.state.selectedId === block.id) { this.state.selectedId = null; }
            await this.load();
        } catch (e) { this.notify(e); }
    }

    // ---- flow width resize (right edge) ----
    startResize(block, ev) {
        ev.preventDefault(); ev.stopPropagation();
        this._resize = { id: block.id, startX: ev.clientX, startPx: this.widthPx(block) };
        this.state.resizingId = block.id;
        this.state.resizeMm = this.widthMmOf(block);
        const move = (e) => this.onResizeMove(e);
        const up = (e) => this.endResize(e, move, up);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }
    onResizeMove(ev) {
        if (!this._resize) { return; }
        let px = this._resize.startPx + (ev.clientX - this._resize.startX);
        px = Math.min(this.canvasPx, Math.max(SCALE * 5, px));
        const pct = Math.round((px / this.canvasPx) * 100);
        const b = this.state.blocks.find((x) => x.id === this._resize.id);
        if (b) {
            b.width_pct = Math.min(100, Math.max(1, pct));
            this.state.resizeMm = Math.round((pct / 100) * this.state.widthMm);
            this.state.blocks = [...this.state.blocks];
        }
    }
    async endResize(ev, move, up) {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const r = this._resize; this._resize = null; this.state.resizingId = null;
        if (!r) { return; }
        const b = this.state.blocks.find((x) => x.id === r.id);
        if (b) { await this.setField(b.id, "width_pct", b.width_pct); }
    }

    // ---- grid move / resize (snap to cm) ----
    startGridMove(block, ev) {
        // Ignore clicks on the eye/delete buttons or the resize grip.
        if (ev.target.closest && ev.target.closest("button, .pdi-gresize")) { return; }
        ev.preventDefault();
        this.pushHistory();
        this.select(block.id);
        this._drag = { id: block.id, mode: "move", sx: ev.clientX, sy: ev.clientY,
            ox: block.grid_x || 0, oy: block.grid_y || 0 };
        this._bindDrag();
    }
    startGridResize(block, ev) {
        ev.preventDefault(); ev.stopPropagation();
        this.pushHistory();
        this.select(block.id);
        this._drag = { id: block.id, mode: "resize", sx: ev.clientX, sy: ev.clientY,
            ow: block.grid_w || 4, oh: block.grid_h || 2 };
        this._bindDrag();
    }
    _bindDrag() {
        const mv = (e) => this.onGridMove(e);
        const up = (e) => this.endGridDrag(e, mv, up);
        window.addEventListener("pointermove", mv);
        window.addEventListener("pointerup", up);
    }
    onGridMove(ev) {
        const d = this._drag; if (!d) { return; }
        const b = this.state.blocks.find((x) => x.id === d.id); if (!b) { return; }
        // Snap to 0.25cm (a quarter of a grid cell) for fine control.
        const step = CELL_PX / 4;
        const dcx = Math.round((ev.clientX - d.sx) / step) * 0.25;
        const dcy = Math.round((ev.clientY - d.sy) / step) * 0.25;
        if (d.mode === "move") {
            b.grid_x = Math.max(0, d.ox + dcx);
            b.grid_y = Math.max(0, d.oy + dcy);
        } else {
            b.grid_w = Math.max(0.25, d.ow + dcx);
            b.grid_h = Math.max(0.25, d.oh + dcy);
        }
        this.state.blocks = [...this.state.blocks];
    }
    async endGridDrag(ev, mv, up) {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", up);
        const d = this._drag; this._drag = null;
        if (!d) { return; }
        const b = this.state.blocks.find((x) => x.id === d.id); if (!b) { return; }
        const vals = d.mode === "move"
            ? { grid_x: b.grid_x, grid_y: b.grid_y }
            : { grid_w: b.grid_w, grid_h: b.grid_h };
        await this.setFields(b.id, vals);
    }

    // ---- preview ----
    async refreshPreview() {
        try {
            // Always render fresh so EVERY change (block fields + header settings)
            // shows immediately — not a cached computed field.
            this.previewHtml = await this.orm.call(
                "pos.invoice.layout", "render_preview_html", [[this.layoutId]]);
            this.state.blocks = [...this.state.blocks];
        } catch (e) { this.notify(e); }
    }

    async setHeaderField(field, ev) {
        const value = ev.target.value;
        try {
            await this.orm.call("pos.invoice.layout", "set_header_setting",
                [[this.layoutId], field, value]);
            this.state.header[field] = value;
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }

    // ---- Company Header dynamic fields (reorder / add / edit / delete) ----
    async loadHeaderFields() {
        try {
            this.state.headerFields = await this.orm.call(
                "pos.invoice.layout", "header_fields", [[this.layoutId]]);
        } catch (e) { this.state.headerFields = []; }
    }
    async addHeaderField() {
        try {
            await this.orm.call("pos.invoice.layout", "add_header_field", [[this.layoutId]]);
            await this.loadHeaderFields();
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }
    async onHeaderFieldInput(fieldId, key, ev) {
        const val = key === "visible" ? ev.target.checked : ev.target.value;
        try {
            await this.orm.call("pos.invoice.layout", "write_header_field",
                [[this.layoutId], fieldId, { [key]: val }]);
            const f = this.state.headerFields.find((x) => x.id === fieldId);
            if (f) { f[key] = val; }
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }
    async moveHeaderField(fieldId, dir) {
        try {
            await this.orm.call("pos.invoice.layout", "move_header_field",
                [[this.layoutId], fieldId, dir]);
            await this.loadHeaderFields();
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }
    async delHeaderField(fieldId) {
        try {
            await this.orm.call("pos.invoice.layout", "del_header_field",
                [[this.layoutId], fieldId]);
            await this.loadHeaderFields();
            await this.refreshPreview();
        } catch (e) { this.notify(e); }
    }

    notify(e) {
        const msg = (e && e.message) || String(e);
        if (this.notification) { this.notification.add(msg, { type: "danger" }); }
    }

    close() { window.history.back(); }
}

registry.category("actions").add("pos_invoice_layout_editor", LayoutEditor);
