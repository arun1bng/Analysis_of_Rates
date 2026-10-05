CREATE TABLE sub_heads (
    sub_head_id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume_no TEXT NOT NULL DEFAULT 'I',
    sub_head_no TEXT NOT NULL,
    sub_head_name TEXT NOT NULL,
    description TEXT
);

CREATE TABLE basic_rates (
    basic_rate_id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    rate NUMERIC
);

CREATE TABLE dar_items (
    dar_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL UNIQUE,
    sub_head_id INTEGER,
    parent_item_code TEXT,
    description TEXT NOT NULL,
    unit TEXT,
    rate NUMERIC
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
    FOREIGN KEY (item_code) REFERENCES dar_items(item_code)
);