BEGIN;

-- Keep absolute time and truncate existing fractional seconds.
ALTER TABLE legal
    ALTER COLUMN del_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', del_dttm),
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm),
    ALTER COLUMN upt_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', upt_dttm);

ALTER TABLE src_snapshot
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm);

ALTER TABLE legal_ver
    ALTER COLUMN del_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', del_dttm),
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm),
    ALTER COLUMN upt_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', upt_dttm);

ALTER TABLE legal_ver_rev
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm);

ALTER TABLE legal_provi
    ALTER COLUMN del_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', del_dttm),
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm),
    ALTER COLUMN upt_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', upt_dttm);

ALTER TABLE cmmn_cd
    ALTER COLUMN del_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', del_dttm),
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm),
    ALTER COLUMN upt_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', upt_dttm);

ALTER TABLE cmmn_cd_hist
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm);

ALTER TABLE legal_prec
    ALTER COLUMN del_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', del_dttm),
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm);

ALTER TABLE legal_prec_rev
    ALTER COLUMN rgst_dttm TYPE TIMESTAMPTZ(0) USING date_trunc('second', rgst_dttm);

COMMIT;
