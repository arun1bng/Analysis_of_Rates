CREATE TABLE sub_heads (
    sub_head_id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume_no TEXT NOT NULL DEFAULT 'I',
    sub_head_no TEXT NOT NULL,
    sub_head_name TEXT NOT NULL,
    description TEXT,
    source_page_pdf INTEGER,
    UNIQUE(volume_no, sub_head_no)
);

CREATE TABLE basic_rates (
    basic_rate_id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    rate NUMERIC,
    rate_basis TEXT,
    source_page_pdf INTEGER,
    source_text TEXT,
    UNIQUE(code, category)
);

CREATE TABLE dar_items (
    dar_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL UNIQUE,
    sub_head_id INTEGER,
    parent_item_code TEXT,
    description TEXT NOT NULL,
    unit TEXT,
    rate NUMERIC,
    rate_basis TEXT,
    computed_cost NUMERIC,
    gst_included INTEGER,
    cpoh_included INTEGER,
    cess_included INTEGER,
    is_main_item INTEGER,
    is_sub_item INTEGER,
    source_page_pdf INTEGER,
    source_page_printed TEXT,
    source_text TEXT, hierarchy_path TEXT,
    FOREIGN KEY (sub_head_id) REFERENCES sub_heads(sub_head_id),
    FOREIGN KEY (parent_item_code) REFERENCES dar_items(item_code)
);

CREATE TABLE item_components (
    item_component_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL,
    component_seq INTEGER,
    component_type TEXT NOT NULL,
    component_code TEXT,
    description TEXT,
    unit TEXT,
    quantity NUMERIC,
    rate NUMERIC,
    amount NUMERIC,
    reference_item_code TEXT,
    source_page_pdf INTEGER,
    source_text TEXT,
    FOREIGN KEY (item_code) REFERENCES dar_items(item_code),
    FOREIGN KEY (reference_item_code) REFERENCES dar_items(item_code)
);