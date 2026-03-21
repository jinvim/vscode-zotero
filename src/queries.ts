// src/queries.ts

// query for zotero items (with creators aggregated as JSON)
export const queryItems = `
            WITH pivoted AS (
                SELECT
                    id.itemID,
                    MAX(CASE WHEN f.fieldName = 'title'       THEN idv.value END) AS title,
                    MAX(CASE WHEN f.fieldName = 'date'        THEN idv.value END) AS date,
                    MAX(CASE WHEN f.fieldName = 'citationKey' THEN idv.value END) AS citeKey
                FROM itemData id
                JOIN itemDataValues idv USING (valueID)
                JOIN fields f ON f.fieldID = id.fieldID
                WHERE f.fieldName IN ('title', 'date', 'citationKey')
                GROUP BY id.itemID
                HAVING citeKey IS NOT NULL
            )
            SELECT
                it.key AS zoteroKey, itypes.typeName AS itemType, it.libraryID,
                p.title, p.date, p.citeKey,
                json_group_array(json_object(
                    'firstName',   c.firstName,
                    'lastName',    c.lastName,
                    'creatorType', ct.creatorType,
                    'orderIndex',  ic.orderIndex
                )) AS creators
            FROM items it
            JOIN itemTypes itypes ON itypes.itemTypeID = it.itemTypeID
            JOIN pivoted p        ON p.itemID = it.itemID
            LEFT JOIN itemCreators ic ON ic.itemID = it.itemID
            LEFT JOIN creators c      ON c.creatorID = ic.creatorID
                AND (c.firstName IS NOT NULL OR c.lastName IS NOT NULL)
            LEFT JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
            GROUP BY it.key, itypes.typeName, it.libraryID, p.title, p.date, p.citeKey;
            `;

// query for getting zotero item(s) by citekey(s) — includes title/typeName/libraryName for picker
export function queryZoteroKeys(citeKeys: string[]): string {
    const strKeys = citeKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(', ');
    return `
                SELECT
                    it.key AS zoteroKey,
                    it.libraryID,
                    itypes.typeName,
                    MAX(CASE WHEN f.fieldName = 'title' THEN idv.value END) AS title,
                    g.name AS libraryName,
                    MAX(CASE WHEN f.fieldName = 'citationKey' THEN idv.value END) AS citeKey
                FROM items it
                    INNER JOIN itemData id     ON id.itemID   = it.itemID
                    INNER JOIN itemDataValues idv ON idv.valueID = id.valueID
                    INNER JOIN fields f         ON f.fieldID   = id.fieldID
                    INNER JOIN itemTypes itypes ON itypes.itemTypeID = it.itemTypeID
                    LEFT JOIN  groups g         ON g.libraryID = it.libraryID
                WHERE f.fieldName IN ('title', 'citationKey')
                GROUP BY it.key, it.libraryID, itypes.typeName, g.name
                HAVING MAX(CASE WHEN f.fieldName = 'citationKey' THEN idv.value END) IN (${strKeys});
            `;
}

// query for getting open options (pdf, doi) for a given zoteroKey + libraryID
export function queryOpenOptions(zoteroKey: string, libraryID: number): string {
    return `
                SELECT
                    MAX(g.groupID)                                          AS groupID,
                    MAX(att.key)                                            AS pdfKey,
                    MAX(CASE WHEN f.fieldName = 'DOI' THEN idv.value END)  AS doi
                FROM items it
                    LEFT JOIN groups g           ON g.libraryID     = it.libraryID
                    LEFT JOIN itemAttachments ia  ON ia.parentItemID = it.itemID
                        AND ia.contentType = 'application/pdf'
                    LEFT JOIN items att           ON att.itemID      = ia.itemID
                    LEFT JOIN itemData id         ON id.itemID       = it.itemID
                    LEFT JOIN itemDataValues idv  ON idv.valueID     = id.valueID
                    LEFT JOIN fields f            ON f.fieldID       = id.fieldID
                WHERE it.key = '${zoteroKey}' AND it.libraryID = ${libraryID};
            `;
}