-- Starter rules are gone: a fresh install now begins with no rules at all and
-- earns each one from a correction someone actually made.
--
-- Existing instances carry up to 42 of them. Remove only the ones nobody has
-- touched — still sitting at the starter prior, never corrected, carrying no
-- tags. A seeded rule that has since accepted or been corrected has a real
-- history behind it and is a learned rule in everything but name, so it is kept
-- and relabelled rather than deleted out from under the household.
--
-- The 6 below is DEFAULT_RULE_PRIOR, the accepted_count every seeded row was
-- written with; a rule still holding exactly that has never been accepted. It
-- is frozen here on purpose — the migration describes rows as they were written,
-- not as a later constant might read.
--
-- rule_tag cascades on delete, so no companion cleanup is needed for the rows
-- that do go.
delete from rule
where provenance = 'seeded'
	and corrected_count = 0
	and accepted_count <= 6
	and not exists (select 1 from rule_tag where rule_tag.rule_id = rule.id);

update rule set provenance = 'learned' where provenance = 'seeded';
