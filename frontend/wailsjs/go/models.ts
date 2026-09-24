export namespace main {
	
	export class Armor {
	    id: string;
	    name: string;
	    image: string;
	    category: string;
	    baseAC: number;
	    isDefault: boolean;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Armor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.category = source["category"];
	        this.baseAC = source["baseAC"];
	        this.isDefault = source["isDefault"];
	        this.data = source["data"];
	    }
	}
	export class Background {
	    id: string;
	    name: string;
	    feat: string;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Background(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.feat = source["feat"];
	        this.data = source["data"];
	    }
	}
	export class Item {
	    id: string;
	    name: string;
	    image: string;
	    weight: number;
	    cost: string;
	    desc: string;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.weight = source["weight"];
	        this.cost = source["cost"];
	        this.desc = source["desc"];
	        this.data = source["data"];
	    }
	}
	export class Weapon {
	    id: string;
	    name: string;
	    image: string;
	    category: string;
	    damage: string;
	    damageType: string;
	    isDefault: boolean;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Weapon(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.category = source["category"];
	        this.damage = source["damage"];
	        this.damageType = source["damageType"];
	        this.isDefault = source["isDefault"];
	        this.data = source["data"];
	    }
	}
	export class Catalog {
	    weapons: Weapon[];
	    armor: Armor[];
	    items: Item[];
	
	    static createFrom(source: any = {}) {
	        return new Catalog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.weapons = this.convertValues(source["weapons"], Weapon);
	        this.armor = this.convertValues(source["armor"], Armor);
	        this.items = this.convertValues(source["items"], Item);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CharacterSummary {
	    id: string;
	    name: string;
	    level: number;
	    raceId: string;
	    classId: string;
	    className: string;
	    portrait: string;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new CharacterSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.level = source["level"];
	        this.raceId = source["raceId"];
	        this.classId = source["classId"];
	        this.className = source["className"];
	        this.portrait = source["portrait"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class Subclass {
	    id: string;
	    classId: string;
	    name: string;
	    image: string;
	    isCustom: boolean;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Subclass(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.classId = source["classId"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.isCustom = source["isCustom"];
	        this.data = source["data"];
	    }
	}
	export class Class {
	    id: string;
	    name: string;
	    image: string;
	    hitDie: number;
	    caster: string;
	    subclassLevel: number;
	    isCustom: boolean;
	    data: Record<string, any>;
	    subclasses: Subclass[];
	
	    static createFrom(source: any = {}) {
	        return new Class(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.hitDie = source["hitDie"];
	        this.caster = source["caster"];
	        this.subclassLevel = source["subclassLevel"];
	        this.isCustom = source["isCustom"];
	        this.data = source["data"];
	        this.subclasses = this.convertValues(source["subclasses"], Subclass);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PackItem {
	    item: Item;
	    qty: number;
	
	    static createFrom(source: any = {}) {
	        return new PackItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.item = this.convertValues(source["item"], Item);
	        this.qty = source["qty"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Pack {
	    id: string;
	    name: string;
	    image: string;
	    cost: string;
	    desc: string;
	    data: Record<string, any>;
	    items: PackItem[];
	
	    static createFrom(source: any = {}) {
	        return new Pack(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.cost = source["cost"];
	        this.desc = source["desc"];
	        this.data = source["data"];
	        this.items = this.convertValues(source["items"], PackItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Equipment {
	    weapons: Weapon[];
	    armor: Armor[];
	    items: Item[];
	    packs: Pack[];
	
	    static createFrom(source: any = {}) {
	        return new Equipment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.weapons = this.convertValues(source["weapons"], Weapon);
	        this.armor = this.convertValues(source["armor"], Armor);
	        this.items = this.convertValues(source["items"], Item);
	        this.packs = this.convertValues(source["packs"], Pack);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Feat {
	    id: string;
	    name: string;
	    category: string;
	    level: number;
	    desc: string;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Feat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.category = source["category"];
	        this.level = source["level"];
	        this.desc = source["desc"];
	        this.data = source["data"];
	    }
	}
	
	
	
	export class Race {
	    id: string;
	    name: string;
	    parentRace?: string;
	    image: string;
	    isCustom: boolean;
	    data: Record<string, any>;
	    subraces: Race[];
	
	    static createFrom(source: any = {}) {
	        return new Race(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentRace = source["parentRace"];
	        this.image = source["image"];
	        this.isCustom = source["isCustom"];
	        this.data = source["data"];
	        this.subraces = this.convertValues(source["subraces"], Race);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Spell {
	    id: string;
	    name: string;
	    kind: string;
	    level: number;
	    school: string;
	    action: string;
	    concentration: boolean;
	    ritual: boolean;
	    desc: string;
	    data: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Spell(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.level = source["level"];
	        this.school = source["school"];
	        this.action = source["action"];
	        this.concentration = source["concentration"];
	        this.ritual = source["ritual"];
	        this.desc = source["desc"];
	        this.data = source["data"];
	    }
	}
	

}

