-- tests/placeholders.sql
-- Copyright (C) 2026 Stefano Natangelo
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Dati finti al posto di nomi, email, titoli e riviste reali.
-- Usato da run.sh SOLO sulla copia locale, dopo aver salvato il database:
-- alla fine dei test il database viene rimesso com'era.
UPDATE user_settings SET setting_value=ELT(MOD(user_id,8)+1,'Alex','Sam','Jordan','Taylor','Morgan','Casey','Robin','Jamie') WHERE setting_name='givenName';
UPDATE user_settings SET setting_value=ELT(MOD(user_id,9)+1,'Smith','Rossi','Garcia','Novak','Silva','Kim','Weber','Dubois','Okafor') WHERE setting_name='familyName';
UPDATE user_settings SET setting_value='' WHERE setting_name IN ('preferredPublicName','biography','signature','preferredAvatarInitials');
UPDATE user_settings SET setting_value='Example University' WHERE setting_name='affiliation';
DELETE FROM user_settings WHERE setting_name IN ('orcid','orcidIsVerified','openid::orcid','profileImage','orcidAccessToken','orcidRefreshToken');
UPDATE users SET email=CONCAT('user',user_id,'@example.org');
UPDATE author_settings SET setting_value=ELT(MOD(author_id,8)+1,'Chris','Dana','Lee','Pat','Kai','Noa','Remy','Sasha') WHERE setting_name='givenName';
UPDATE author_settings SET setting_value=ELT(MOD(author_id,9)+1,'Bianchi','Martin','Lopez','Schmidt','Costa','Park','Nilsson','Moreau','Adeyemi') WHERE setting_name='familyName';
UPDATE author_settings SET setting_value='' WHERE setting_name IN ('preferredPublicName','biography','url','competingInterests');
DELETE FROM author_settings WHERE setting_name IN ('orcid','orcidIsVerified');
UPDATE authors SET email=CONCAT('author',author_id,'@example.org');
UPDATE author_affiliation_settings SET setting_value='Example Institute' WHERE setting_name='name';
UPDATE publication_settings SET setting_value=CONCAT(ELT(MOD(publication_id,8)+1,'A placeholder study of','Sample findings on','An example review of','Notes on','A demonstration trial of','Preliminary data on','A test case of','Exploring'),' ',ELT(MOD(publication_id,6)+1,'sleep and memory','urban air quality','hospital workflows','rare enzymes','patient education','clinical checklists')) WHERE setting_name='title';
UPDATE publication_settings SET setting_value='' WHERE setting_name IN ('subtitle','prefix');
UPDATE publication_settings SET setting_value='<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Placeholder abstract.</p>' WHERE setting_name='abstract';
UPDATE publication_settings SET setting_value='Example Author' WHERE setting_name='copyrightHolder';
UPDATE journal_settings SET setting_value=ELT(journal_id,'Journal of Examples','Sample Medical Review','Demo Studies Quarterly','Test Journal of Health') WHERE setting_name='name';
UPDATE journal_settings SET setting_value=ELT(journal_id,'JEX','SMR','DSQ','TJH') WHERE setting_name IN ('acronym','abbreviation');
UPDATE journal_settings SET setting_value='<p>Lorem ipsum dolor sit amet. Placeholder journal description.</p>' WHERE setting_name='description';
UPDATE journal_settings SET setting_value='Editorial Office' WHERE setting_name IN ('contactName','supportName');
UPDATE journal_settings SET setting_value='editor@example.org' WHERE setting_name IN ('contactEmail','supportEmail');
UPDATE journal_settings SET setting_value='Example Publisher' WHERE setting_name='publisherInstitution';
UPDATE site_settings SET setting_value='Example Publishing Platform' WHERE setting_name='title';
UPDATE site_settings SET setting_value='Site Admin' WHERE setting_name='contactName';
UPDATE site_settings SET setting_value='admin@example.org' WHERE setting_name='contactEmail';
UPDATE submission_file_settings SET setting_value=CONCAT('document-',submission_file_id,IF(LOCATE('.',setting_value)>0,CONCAT('.',SUBSTRING_INDEX(setting_value,'.',-1)),'')) WHERE setting_name='name';
UPDATE notes SET title='Sample discussion', contents='<p>Placeholder message.</p>';
UPDATE issue_settings SET setting_value='Sample issue' WHERE setting_name='title';
UPDATE issue_settings SET setting_value='' WHERE setting_name='description';
-- Una seconda lingua per i moduli della rivista di prova (solo i moduli, non
-- l'interfaccia), per vedere due lingue insieme
UPDATE site SET installed_locales='["en","es"]' WHERE installed_locales='["en"]';
UPDATE journal_settings SET setting_value='["en","es"]' WHERE setting_name='supportedFormLocales' AND setting_value='["en"]' AND journal_id=(SELECT journal_id FROM journals WHERE path='jse');
