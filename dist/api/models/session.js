"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionAPI = void 0;
const utils_1 = require("../utils");
const hashUtils_1 = __importDefault(require("../../lib/hashUtils"));
class SessionAPI {
    api;
    constructor(api) {
        this.api = api;
    }
    // Unlike other models, this one will not throw on missing data, but will return undefined instead.
    async getOne(options) {
        const parsedOptions = (0, utils_1.parseData)(options);
        const queryString = `SELECT * FROM session WHERE ${parsedOptions.strings.join(' AND ')} LIMIT 1;`;
        const data = await (0, utils_1.executeQuery)(queryString, parsedOptions.values);
        const session = data[0];
        if (!session || !session.user_id)
            return session;
        const user = await this.api.user.getOne({ 'user.id': session.user_id }, false, true);
        session.user = user;
        return session;
    }
    async post() {
        const data = hashUtils_1.default.createRandom32String();
        const hash = hashUtils_1.default.createHash(data);
        const queryString = `INSERT INTO session (hash, created_at) VALUES (?, ?);`;
        return await (0, utils_1.executeQuery)(queryString, [hash, new Date()]);
    }
    async put(options, changes) {
        const { user_id } = changes;
        const parsedOptions = (0, utils_1.parseData)(options);
        const queryString = `UPDATE session SET user_id = ? WHERE ${parsedOptions.strings.join(' AND ')}`;
        return await (0, utils_1.executeQuery)(queryString, [user_id, ...parsedOptions.values]);
    }
    /**
     * for internal use only - does not conform to the standard return format!
     * @param options
     * @returns {Promise<ResultSetHeader>}
     */
    async del(options) {
        const parsedOptions = (0, utils_1.parseData)(options);
        const queryString = `DELETE FROM session WHERE ${parsedOptions.strings.join(' AND ')}`;
        return await (0, utils_1.executeQuery)(queryString, parsedOptions.values);
    }
    async purge() {
        return await (0, utils_1.executeQuery)('DELETE FROM session WHERE created_at < NOW() - INTERVAL 8 DAY');
    }
}
exports.SessionAPI = SessionAPI;
