/**
 * Options Page Script
 * 處理自訂網域規則的 CRUD 操作和 UI 互動
 */

import {
	type DomainRule,
	addRule,
	deleteRule,
	getAllRules,
	initializeCustomDomainsConfig,
	updateRule,
} from "./domain-rules";

// ============================================================================
// DOM Elements
// ============================================================================

// Form elements
const addRuleForm = document.getElementById("addRuleForm") as HTMLFormElement;
const domainInput = document.getElementById("domainInput") as HTMLInputElement;
const selectorInput = document.getElementById(
	"selectorInput",
) as HTMLInputElement;

// Table elements
const rulesTableBody = document.getElementById(
	"rulesTableBody",
) as HTMLTableSectionElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;

// Status message
const statusMessage = document.getElementById(
	"statusMessage",
) as HTMLDivElement;
const statusText = statusMessage.querySelector(
	".status-text",
) as HTMLSpanElement;

// Edit modal
const editModal = document.getElementById("editModal") as HTMLDivElement;
const editRuleForm = document.getElementById("editRuleForm") as HTMLFormElement;
const editRuleId = document.getElementById("editRuleId") as HTMLInputElement;
const editDomainInput = document.getElementById(
	"editDomainInput",
) as HTMLInputElement;
const editSelectorInput = document.getElementById(
	"editSelectorInput",
) as HTMLInputElement;
const closeModal = document.getElementById("closeModal") as HTMLButtonElement;
const cancelEdit = document.getElementById("cancelEdit") as HTMLButtonElement;

// Delete modal
const deleteModal = document.getElementById("deleteModal") as HTMLDivElement;
const deleteRuleId = document.getElementById(
	"deleteRuleId",
) as HTMLInputElement;
const deleteRuleDomain = document.getElementById(
	"deleteRuleDomain",
) as HTMLParagraphElement;
const closeDeleteModal = document.getElementById(
	"closeDeleteModal",
) as HTMLButtonElement;
const cancelDelete = document.getElementById(
	"cancelDelete",
) as HTMLButtonElement;
const confirmDelete = document.getElementById(
	"confirmDelete",
) as HTMLButtonElement;

// ============================================================================
// Status Message Functions
// ============================================================================

function showStatus(message: string, type: "success" | "error") {
	statusText.textContent = message;
	statusMessage.className = `status-message ${type}`;
	statusMessage.style.display = "block";

	// Auto hide after 3 seconds
	setTimeout(() => {
		statusMessage.style.display = "none";
	}, 3000);
}

// ============================================================================
// Render Rules Table
// ============================================================================

async function renderRulesTable() {
	const rules = await getAllRules();

	// Clear existing rows
	rulesTableBody.innerHTML = "";

	if (rules.length === 0) {
		emptyState.style.display = "block";
		return;
	}

	emptyState.style.display = "none";

	// Render each rule
	for (const rule of rules) {
		const row = createRuleRow(rule);
		rulesTableBody.appendChild(row);
	}
}

function createRuleRow(rule: DomainRule): HTMLTableRowElement {
	const row = document.createElement("tr");

	// Checkbox column
	const checkboxCell = document.createElement("td");
	checkboxCell.className = "col-checkbox";
	const checkbox = document.createElement("input");
	checkbox.type = "checkbox";
	checkbox.className = "rule-checkbox";
	checkbox.checked = rule.enabled;
	checkbox.addEventListener("change", () => handleToggleEnabled(rule.id));
	checkboxCell.appendChild(checkbox);

	// Domain column
	const domainCell = document.createElement("td");
	domainCell.className = "col-domain";
	const domainText = document.createElement("span");
	domainText.className = "domain-text";
	domainText.textContent = rule.domain;
	domainCell.appendChild(domainText);

	// Selector column
	const selectorCell = document.createElement("td");
	selectorCell.className = "col-selector";
	const selectorText = document.createElement("span");
	selectorText.className = "selector-text";
	selectorText.textContent = rule.selector;
	selectorCell.appendChild(selectorText);

	// Actions column
	const actionsCell = document.createElement("td");
	actionsCell.className = "col-actions";
	const actionsContainer = document.createElement("div");
	actionsContainer.className = "action-buttons";

	const editBtn = document.createElement("button");
	editBtn.className = "btn btn-secondary btn-sm";
	editBtn.textContent = "Edit";
	editBtn.addEventListener("click", () => handleEditRule(rule));

	const deleteBtn = document.createElement("button");
	deleteBtn.className = "btn btn-danger btn-sm";
	deleteBtn.textContent = "Delete";
	deleteBtn.addEventListener("click", () => handleDeleteRule(rule));

	actionsContainer.appendChild(editBtn);
	actionsContainer.appendChild(deleteBtn);
	actionsCell.appendChild(actionsContainer);

	// Append all cells
	row.appendChild(checkboxCell);
	row.appendChild(domainCell);
	row.appendChild(selectorCell);
	row.appendChild(actionsCell);

	return row;
}

// ============================================================================
// Domain Pattern Validation
// ============================================================================

/**
 * 驗證網域 pattern 格式（嚴格模式）
 * 只允許兩種格式：
 * 1. example.com (精確根域)
 * 2. *.example.com (子域 wildcard)
 */
function validateDomainPattern(domain: string): {
	valid: boolean;
	error?: string;
} {
	// 必須包含至少一個點（TLD 要求）
	if (!domain.includes(".")) {
		return {
			valid: false,
			error: "Domain must include at least one dot (e.g., example.com)",
		};
	}

	// 格式 1: 精確根域（不包含 wildcard）
	if (!domain.includes("*")) {
		// 簡單檢查：只能包含字母、數字、點和連字號
		if (!/^[a-z0-9.-]+$/i.test(domain)) {
			return {
				valid: false,
				error: "Domain can only contain letters, numbers, dots and hyphens",
			};
		}
		return { valid: true };
	}

	// 格式 2: 子域 wildcard (*.example.com)
	if (domain.startsWith("*.")) {
		const rootDomain = domain.substring(2);
		// 檢查根域部分的格式
		if (!/^[a-z0-9.-]+$/i.test(rootDomain)) {
			return {
				valid: false,
				error: "Domain can only contain letters, numbers, dots and hyphens",
			};
		}
		return { valid: true };
	}

	// 其他情況（wildcard 不在開頭，或使用多個 wildcard）
	return {
		valid: false,
		error:
			"Only two formats allowed: 'example.com' or '*.example.com' (wildcard must be at the beginning)",
	};
}

// ============================================================================
// Add Rule Handler
// ============================================================================

async function handleAddRule(event: Event) {
	event.preventDefault();

	const domain = domainInput.value.trim();
	const selector = selectorInput.value.trim();

	if (!domain || !selector) {
		showStatus("Please fill in all fields", "error");
		return;
	}

	// 驗證 domain pattern 格式
	const validation = validateDomainPattern(domain);
	if (!validation.valid) {
		showStatus(validation.error || "Invalid domain pattern", "error");
		return;
	}

	try {
		await addRule(domain, selector);
		showStatus("Rule added successfully", "success");

		// Clear form
		addRuleForm.reset();

		// Refresh table
		await renderRulesTable();
	} catch (error) {
		console.error("Error adding rule:", error);
		showStatus("Failed to add rule", "error");
	}
}

// ============================================================================
// Toggle Enabled Handler
// ============================================================================

async function handleToggleEnabled(ruleId: string) {
	try {
		const rules = await getAllRules();
		const rule = rules.find((r) => r.id === ruleId);

		if (!rule) {
			showStatus("Rule not found", "error");
			return;
		}

		const success = await updateRule(ruleId, { enabled: !rule.enabled });

		if (success) {
			showStatus(rule.enabled ? "Rule disabled" : "Rule enabled", "success");
			await renderRulesTable();
		} else {
			showStatus("Failed to update rule", "error");
		}
	} catch (error) {
		console.error("Error toggling rule:", error);
		showStatus("Failed to update rule", "error");
	}
}

// ============================================================================
// Edit Rule Handlers
// ============================================================================

function handleEditRule(rule: DomainRule) {
	// Populate form
	editRuleId.value = rule.id;
	editDomainInput.value = rule.domain;
	editSelectorInput.value = rule.selector;

	// Show modal
	editModal.style.display = "flex";
}

function closeEditModal() {
	editModal.style.display = "none";
	editRuleForm.reset();
}

async function handleEditSubmit(event: Event) {
	event.preventDefault();

	const ruleId = editRuleId.value;
	const domain = editDomainInput.value.trim();
	const selector = editSelectorInput.value.trim();

	if (!domain || !selector) {
		showStatus("Please fill in all fields", "error");
		return;
	}

	// 驗證 domain pattern 格式
	const validation = validateDomainPattern(domain);
	if (!validation.valid) {
		showStatus(validation.error || "Invalid domain pattern", "error");
		return;
	}

	try {
		const success = await updateRule(ruleId, { domain, selector });

		if (success) {
			showStatus("Rule updated successfully", "success");
			closeEditModal();
			await renderRulesTable();
		} else {
			showStatus("Rule not found", "error");
		}
	} catch (error) {
		console.error("Error updating rule:", error);
		showStatus("Failed to update rule", "error");
	}
}

// ============================================================================
// Delete Rule Handlers
// ============================================================================

function handleDeleteRule(rule: DomainRule) {
	// Populate modal
	deleteRuleId.value = rule.id;
	deleteRuleDomain.textContent = rule.domain;

	// Show modal
	deleteModal.style.display = "flex";
}

function closeDeleteModalFn() {
	deleteModal.style.display = "none";
}

async function handleDeleteConfirm() {
	const ruleId = deleteRuleId.value;

	try {
		const success = await deleteRule(ruleId);

		if (success) {
			showStatus("Rule deleted successfully", "success");
			closeDeleteModalFn();
			await renderRulesTable();
		} else {
			showStatus("Rule not found", "error");
		}
	} catch (error) {
		console.error("Error deleting rule:", error);
		showStatus("Failed to delete rule", "error");
	}
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
	// Add rule form
	addRuleForm.addEventListener("submit", handleAddRule);

	// Edit modal
	editRuleForm.addEventListener("submit", handleEditSubmit);
	closeModal.addEventListener("click", closeEditModal);
	cancelEdit.addEventListener("click", closeEditModal);
	editModal
		.querySelector(".modal-overlay")
		?.addEventListener("click", closeEditModal);

	// Delete modal
	confirmDelete.addEventListener("click", handleDeleteConfirm);
	closeDeleteModal.addEventListener("click", closeDeleteModalFn);
	cancelDelete.addEventListener("click", closeDeleteModalFn);
	deleteModal
		.querySelector(".modal-overlay")
		?.addEventListener("click", closeDeleteModalFn);
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
	try {
		// Initialize storage with default rules if needed
		await initializeCustomDomainsConfig();

		// Render rules table
		await renderRulesTable();

		// Setup event listeners
		setupEventListeners();
	} catch (error) {
		console.error("Error initializing options page:", error);
		showStatus("Failed to load rules", "error");
	}
}

// Start the app
init();
