UPDATE schema_version SET version = 5, comment = 'Use on delete cascade', time = NOW();

ALTER TABLE item
DROP FOREIGN KEY item_ibfk_2;
ALTER TABLE item
ADD CONSTRAINT item_ibfk_2
FOREIGN KEY (universe_id) REFERENCES universe (id)
ON DELETE CASCADE;

ALTER TABLE followeruniverse
DROP FOREIGN KEY followeruniverse_ibfk_1;
ALTER TABLE followeruniverse
ADD CONSTRAINT followeruniverse_ibfk_1
FOREIGN KEY (universe_id) REFERENCES universe (id)
ON DELETE CASCADE;
ALTER TABLE followeruniverse
DROP FOREIGN KEY followeruniverse_ibfk_2;
ALTER TABLE followeruniverse
ADD CONSTRAINT followeruniverse_ibfk_2
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE authoruniverse
DROP FOREIGN KEY authoruniverse_ibfk_1;
ALTER TABLE authoruniverse
ADD CONSTRAINT authoruniverse_ibfk_1
FOREIGN KEY (universe_id) REFERENCES universe (id)
ON DELETE CASCADE;
ALTER TABLE authoruniverse
DROP FOREIGN KEY authoruniverse_ibfk_2;
ALTER TABLE authoruniverse
ADD CONSTRAINT authoruniverse_ibfk_2
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE universenotification
DROP FOREIGN KEY universenotification_ibfk_1;
ALTER TABLE universenotification
ADD CONSTRAINT universenotification_ibfk_1
FOREIGN KEY (universe_id) REFERENCES universe (id)
ON DELETE CASCADE;
ALTER TABLE universenotification
DROP FOREIGN KEY universenotification_ibfk_2;
ALTER TABLE universenotification
ADD CONSTRAINT universenotification_ibfk_2
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE universeaccessrequest
DROP FOREIGN KEY universeaccessrequest_ibfk_1;
ALTER TABLE universeaccessrequest
ADD CONSTRAINT universeaccessrequest_ibfk_1
FOREIGN KEY (universe_id) REFERENCES universe (id)
ON DELETE CASCADE;
ALTER TABLE universeaccessrequest
DROP FOREIGN KEY universeaccessrequest_ibfk_2;
ALTER TABLE universeaccessrequest
ADD CONSTRAINT universeaccessrequest_ibfk_2
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE discussion
DROP FOREIGN KEY discussion_ibfk_1;
ALTER TABLE discussion
ADD CONSTRAINT discussion_ibfk_1
FOREIGN KEY (universe_id) REFERENCES universe (id)
ON DELETE CASCADE;

ALTER TABLE threadnotification
DROP FOREIGN KEY threadnotification_ibfk_1;
ALTER TABLE threadnotification
ADD CONSTRAINT threadnotification_ibfk_1
FOREIGN KEY (thread_id) REFERENCES discussion (id)
ON DELETE CASCADE;
ALTER TABLE threadnotification
DROP FOREIGN KEY threadnotification_ibfk_2;
ALTER TABLE threadnotification
ADD CONSTRAINT threadnotification_ibfk_2
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE threadcomment
DROP FOREIGN KEY threadcomment_ibfk_2;
ALTER TABLE threadcomment
ADD CONSTRAINT threadcomment_ibfk_2
FOREIGN KEY (comment_id) REFERENCES comment (id)
ON DELETE CASCADE;

ALTER TABLE itemevent
DROP FOREIGN KEY itemevent_ibfk_1;
ALTER TABLE itemevent
ADD CONSTRAINT itemevent_ibfk_1
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE timelineitem
DROP FOREIGN KEY timelineitem_ibfk_1;
ALTER TABLE timelineitem
ADD CONSTRAINT timelineitem_ibfk_1
FOREIGN KEY (timeline_id) REFERENCES item (id)
ON DELETE CASCADE;
ALTER TABLE timelineitem
DROP FOREIGN KEY timelineitem_ibfk_2;
ALTER TABLE timelineitem
ADD CONSTRAINT timelineitem_ibfk_2
FOREIGN KEY (event_id) REFERENCES itemevent (id)
ON DELETE CASCADE;

ALTER TABLE itemimage
DROP FOREIGN KEY itemimage_ibfk_1;
ALTER TABLE itemimage
ADD CONSTRAINT itemimage_ibfk_1
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE itemnote
DROP FOREIGN KEY itemnote_ibfk_1;
ALTER TABLE itemnote
ADD CONSTRAINT itemnote_ibfk_1
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;
ALTER TABLE itemnote
DROP FOREIGN KEY itemnote_ibfk_2;
ALTER TABLE itemnote
ADD CONSTRAINT itemnote_ibfk_2
FOREIGN KEY (note_id) REFERENCES note (id)
ON DELETE CASCADE;

ALTER TABLE notetag
DROP FOREIGN KEY notetag_ibfk_1;
ALTER TABLE notetag
ADD CONSTRAINT notetag_ibfk_1
FOREIGN KEY (note_id) REFERENCES note (id)
ON DELETE CASCADE;

ALTER TABLE itemnotification
DROP FOREIGN KEY itemnotification_ibfk_1;
ALTER TABLE itemnotification
ADD CONSTRAINT itemnotification_ibfk_1
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;
ALTER TABLE itemnotification
DROP FOREIGN KEY itemnotification_ibfk_2;
ALTER TABLE itemnotification
ADD CONSTRAINT itemnotification_ibfk_2
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE lineage
DROP FOREIGN KEY lineage_ibfk_1;
ALTER TABLE lineage
ADD CONSTRAINT lineage_ibfk_1
FOREIGN KEY (parent_id) REFERENCES item (id)
ON DELETE CASCADE;
ALTER TABLE lineage
DROP FOREIGN KEY lineage_ibfk_2;
ALTER TABLE lineage
ADD CONSTRAINT lineage_ibfk_2
FOREIGN KEY (child_id) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE tag
DROP FOREIGN KEY tag_ibfk_1;
ALTER TABLE tag
ADD CONSTRAINT tag_ibfk_1
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE snooze
DROP FOREIGN KEY snooze_ibfk_1;
ALTER TABLE snooze
ADD CONSTRAINT snooze_ibfk_1
FOREIGN KEY (snoozed_by) REFERENCES user (id)
ON DELETE CASCADE;
ALTER TABLE snooze
DROP FOREIGN KEY snooze_ibfk_2;
ALTER TABLE snooze
ADD CONSTRAINT snooze_ibfk_2
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE itemcomment
DROP FOREIGN KEY itemcomment_ibfk_1;
ALTER TABLE itemcomment
ADD CONSTRAINT itemcomment_ibfk_1
FOREIGN KEY (item_id) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE itemlink
DROP FOREIGN KEY itemlink_ibfk_1;
ALTER TABLE itemlink
ADD CONSTRAINT itemlink_ibfk_1
FOREIGN KEY (from_item) REFERENCES item (id)
ON DELETE CASCADE;

ALTER TABLE eventorder
DROP FOREIGN KEY eventorder_ibfk_1;
ALTER TABLE eventorder
ADD CONSTRAINT eventorder_ibfk_1
FOREIGN KEY (former) REFERENCES itemevent (id)
ON DELETE CASCADE;
ALTER TABLE eventorder
DROP FOREIGN KEY eventorder_ibfk_2;
ALTER TABLE eventorder
ADD CONSTRAINT eventorder_ibfk_2
FOREIGN KEY (latter) REFERENCES itemevent (id)
ON DELETE CASCADE;

ALTER TABLE contact
DROP FOREIGN KEY contact_ibfk_1;
ALTER TABLE contact
ADD CONSTRAINT contact_ibfk_1
FOREIGN KEY (requesting_user) REFERENCES user (id)
ON DELETE CASCADE;
ALTER TABLE contact
DROP FOREIGN KEY contact_ibfk_2;
ALTER TABLE contact
ADD CONSTRAINT contact_ibfk_2
FOREIGN KEY (accepting_user) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE note
DROP FOREIGN KEY note_ibfk_1;
ALTER TABLE note
ADD CONSTRAINT note_ibfk_1
FOREIGN KEY (author_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE notificationsubscription
DROP FOREIGN KEY notificationsubscription_ibfk_1;
ALTER TABLE notificationsubscription
ADD CONSTRAINT notificationsubscription_ibfk_1
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE sentnotification
DROP FOREIGN KEY sentnotification_ibfk_1;
ALTER TABLE sentnotification
ADD CONSTRAINT sentnotification_ibfk_1
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE userimage
DROP FOREIGN KEY userimage_ibfk_1;
ALTER TABLE userimage
ADD CONSTRAINT userimage_ibfk_1
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE userverification
DROP FOREIGN KEY userverification_ibfk_1;
ALTER TABLE userverification
ADD CONSTRAINT userverification_ibfk_1
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE userpasswordreset
DROP FOREIGN KEY userpasswordreset_ibfk_1;
ALTER TABLE userpasswordreset
ADD CONSTRAINT userpasswordreset_ibfk_1
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE usernamechange
DROP FOREIGN KEY usernamechange_ibfk_1;
ALTER TABLE usernamechange
ADD CONSTRAINT usernamechange_ibfk_1
FOREIGN KEY (changed_for) REFERENCES user (id)
ON DELETE CASCADE;

ALTER TABLE notificationtype
DROP FOREIGN KEY notificationtype_ibfk_1;
ALTER TABLE notificationtype
ADD CONSTRAINT notificationtype_ibfk_1
FOREIGN KEY (user_id) REFERENCES user (id)
ON DELETE CASCADE;
