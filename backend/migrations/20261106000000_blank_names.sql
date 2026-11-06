UPDATE servers SET name = 'Server'
WHERE name ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';

UPDATE database_instances SET display = kind
WHERE display ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';

UPDATE database_hosts SET display = left(public_host, 64)
WHERE display ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';

UPDATE nodes SET display = 'Node'
WHERE display ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';

UPDATE projects SET name = slug
WHERE name ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';

UPDATE api_keys SET name = 'API key'
WHERE name ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';

UPDATE user_ssh_keys SET name = 'SSH key'
WHERE name ~ '^[[:space:][:cntrl:]\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]*$';
