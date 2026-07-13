"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cond = exports.QueryBuilder = exports.parseData = exports.RollbackError = exports.tierLimits = exports.tierAllowance = exports.tiers = exports.paidTiers = exports.plans = exports.perms = void 0;
exports.executeQuery = executeQuery;
exports.withTransaction = withTransaction;
exports.getPfpUrl = getPfpUrl;
exports.sendCachedImage = sendCachedImage;
exports.handleAsNull = handleAsNull;
exports.handleErrorWithData = handleErrorWithData;
const db_1 = __importDefault(require("../db"));
const md5_1 = __importDefault(require("md5"));
const logger_1 = __importDefault(require("../logger"));
var perms;
(function (perms) {
    perms[perms["NONE"] = 0] = "NONE";
    perms[perms["READ"] = 1] = "READ";
    perms[perms["COMMENT"] = 2] = "COMMENT";
    perms[perms["WRITE"] = 3] = "WRITE";
    perms[perms["ADMIN"] = 4] = "ADMIN";
    perms[perms["OWNER"] = 5] = "OWNER";
})(perms || (exports.perms = perms = {}));
var plans;
(function (plans) {
    plans[plans["FREE"] = 0] = "FREE";
    plans[plans["PREMIUM"] = 1] = "PREMIUM";
    plans[plans["BETA"] = 2] = "BETA";
    plans[plans["PREMIUM_BETA"] = 3] = "PREMIUM_BETA";
    plans[plans["SUPER"] = 4] = "SUPER";
})(plans || (exports.plans = plans = {}));
exports.paidTiers = {
    PREMIUM: 1,
};
exports.tiers = {
    FREE: 0,
    ...exports.paidTiers,
};
exports.tierAllowance = {
    [plans.FREE]: { total: 5, [exports.tiers.PREMIUM]: 0 },
    [plans.PREMIUM]: { total: 20, [exports.tiers.PREMIUM]: 5 },
    [plans.BETA]: { total: 5, [exports.tiers.PREMIUM]: 1 },
    [plans.PREMIUM_BETA]: { total: 20, [exports.tiers.PREMIUM]: 5 },
    [plans.SUPER]: { total: 999, [exports.tiers.PREMIUM]: 99 },
};
exports.tierLimits = {
    [exports.tiers.FREE]: { images: 25_000_000 },
    [exports.tiers.PREMIUM]: { images: 5_000_000_000 },
};
async function executeQuery(query, values = [], conn) {
    const [results] = await (conn ?? db_1.default).execute(query, values);
    return results;
}
class RollbackError extends Error {
}
exports.RollbackError = RollbackError;
async function withTransaction(callback) {
    const connection = await db_1.default.getConnection();
    try {
        await connection.beginTransaction();
        await callback(connection);
        await connection.commit();
    }
    catch (err) {
        await connection.rollback();
        logger_1.default.warn('Transaction rolled back.');
        if (!(err instanceof RollbackError)) {
            throw err;
        }
    }
    finally {
        connection.release();
    }
}
const parseData = (conditions) => {
    if (!conditions)
        return { strings: [], values: [] };
    const keys = Object.keys(conditions).filter(key => conditions[key] !== undefined);
    const values = keys.map(key => conditions[key]);
    const strings = keys.map(key => `${key} = ?`);
    return { strings, values };
};
exports.parseData = parseData;
class QueryBuilder {
    table;
    selects;
    selectValues;
    joins;
    whereCond;
    groups;
    order;
    orderDesc;
    resultLimit;
    unions;
    constructor() {
        this.table = null;
        this.selects = {};
        this.selectValues = {};
        this.joins = [];
        this.whereCond = null;
        this.groups = {};
        this.order = [];
        this.orderDesc = [];
        this.resultLimit = null;
        this.unions = [];
    }
    select(col, selectAs = null, value = null) {
        this.selects[col] = selectAs;
        this.selectValues[col] = value;
        return this;
    }
    from(table) {
        this.table = table;
        return this;
    }
    join(type, table, on) {
        this.joins.push([type, table, on]);
    }
    innerJoin(table, on) {
        this.join('INNER', table, on);
        return this;
    }
    leftJoin(table, on) {
        this.join('LEFT', table, on);
        return this;
    }
    where(cond) {
        if ((cond instanceof MultiCond || cond.check))
            this.whereCond = cond;
        return this;
    }
    groupBy(col) {
        if (col instanceof Array)
            col.forEach(args => this.groupBy(args));
        else
            this.groups[col] = true;
        return this;
    }
    orderBy(col, orderDesc = false) {
        this.order.push(col);
        this.orderDesc.push(orderDesc);
        return this;
    }
    limit(l) {
        this.resultLimit = l;
        return this;
    }
    union(query) {
        this.unions.push(query);
        return this;
    }
    compile() {
        const selectCols = Object.keys(this.selects);
        let queryStr = '';
        let values = [];
        if (selectCols.length) {
            if (!this.table)
                throw 'No table specified!';
            queryStr += `SELECT ${selectCols.map(col => {
                if (this.selectValues[col]) {
                    if (this.selectValues[col] instanceof Array)
                        values = [...values, ...this.selectValues[col]];
                    else
                        values = [...values, this.selectValues[col]];
                }
                if (this.selects[col])
                    return `${col} AS ${this.selects[col]}`;
                else
                    return col;
            }).join(', ')}`;
            queryStr += ` FROM ${this.table}`;
            for (const [type, table, on] of this.joins) {
                const tableStr = table instanceof Array ? table.join(' AS ') : table;
                queryStr += ` ${type} JOIN ${tableStr}`;
                if (on && on instanceof Cond) {
                    const [str, vals] = on.export();
                    queryStr += ` ON ${str}`;
                    values = [...values, ...vals.filter(val => val !== undefined)];
                }
            }
            if (this.whereCond) {
                const [str, vals] = this.whereCond.export();
                queryStr += ` WHERE ${str}`;
                values = [...values, ...vals.filter(val => val !== undefined)];
            }
            const groupCols = Object.keys(this.groups);
            if (groupCols.length > 0) {
                queryStr += ` GROUP BY ${groupCols.join(', ')}`;
            }
            if (this.order.length) {
                const orderStr = this.order.map((col, i) => `${col} ${this.orderDesc[i] ? 'DESC' : 'ASC'}`);
                queryStr += ` ORDER BY ${orderStr}`;
            }
            if (this.resultLimit) {
                queryStr += ` LIMIT ${this.resultLimit}`;
            }
        }
        else if (this.unions.length) {
            const unionData = this.unions.map(query => query.compile());
            const strs = [];
            for (const [str, vals] of unionData) {
                strs.push(str);
                values = values.concat(vals);
            }
            queryStr += strs.join(' UNION ');
        }
        return [queryStr, values];
    }
    async execute() {
        const [queryStr, values] = this.compile();
        return await executeQuery(queryStr, values);
    }
}
exports.QueryBuilder = QueryBuilder;
class Cond {
    check;
    value;
    constructor(check, value) {
        this.check = check;
        this.value = value;
    }
    or(cond, value) {
        if (!(cond instanceof Cond))
            return this.or(new Cond(cond, value));
        if (cond && !(cond.check || cond instanceof MultiCond))
            return this;
        if (this && !(this.check || this instanceof MultiCond))
            return cond;
        return new MultiCond('OR', this, cond);
    }
    and(cond, value) {
        if (!(cond instanceof Cond))
            return this.and(new Cond(cond, value));
        if (cond && !(cond.check || cond instanceof MultiCond))
            return this;
        if (this && !(this.check || this instanceof MultiCond))
            return cond;
        return new MultiCond('AND', this, cond);
    }
    export() {
        return [this.check, [this.value]];
    }
}
exports.Cond = Cond;
class MultiCond extends Cond {
    type;
    a;
    b;
    constructor(type, a, b) {
        super();
        this.type = type;
        this.a = a;
        this.b = b;
    }
    export() {
        const [aStr, aValues] = this.a.export();
        const [bStr, bValues] = this.b.export();
        if (!(aStr && bStr))
            return [`${aStr || bStr || ''}`, [...aValues, ...bValues]];
        return [`(${aStr} ${this.type} ${bStr})`, [...aValues, ...bValues]];
    }
}
function getPfpUrl(user) {
    return user.hasPfp ? `/api/users/${user.username}/pfp` : `https://www.gravatar.com/avatar/${(0, md5_1.default)(user.email ?? '')}.jpg`;
}
function sendCachedImage(req, res, image, cacheKey, immutable) {
    if (!image)
        return undefined;
    res.contentType(image.mimetype);
    if (req.query.download === '1')
        res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
    res.setHeader('ETag', `"img-${cacheKey}"`);
    res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (req.fresh) {
        res.status(304).end();
        return undefined;
    }
    return image.data;
}
function handleAsNull(type) {
    if (type instanceof Array) {
        return (error) => {
            if (type.some(t => error instanceof t)) {
                return null;
            }
            throw error;
        };
    }
    else {
        return (error) => {
            if (error instanceof type) {
                return null;
            }
            throw error;
        };
    }
}
function handleErrorWithData(error) {
    if (error.data) {
        return error.data;
    }
    throw error;
}
