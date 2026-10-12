CREATE TABLE planned_budget_expenses (
  transaction_id uuid PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES planned_budgets(id) ON DELETE RESTRICT,
  occurrence_date date NOT NULL,
  is_finished boolean NOT NULL DEFAULT false,
  request_digest varchar(64) NOT NULL
);
CREATE INDEX idx_planned_budget_expenses_occurrence ON planned_budget_expenses(budget_id, occurrence_date);
