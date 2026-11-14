const border_width = 3;

const ROOTS = [
    {
        code: 'a',
        label: {
            type: 'text',
            val: 'X',
        },
        reaf: {},
    },
    {
        code: 'b',
        label: {
            type: 'icon',
            code: 'github',
            val: 'Github',
        },
        reaf: {},
    },
    {
        code: 'c',
        label: {
            type: 'icon',
            code: 'menu',
            val: 'サイドメニューの項目',
        },
        reaf: {},
    },
].map(d=> {
    d.size = { w: 55, h: 55 };
    d.position = { x: null, y: null };
    d.border = { w: border_width };
    d.branch = {};

    return d;
}).reduce((ht, item)=> {
    if (ht[item.code])
        throw new Error('Dupulicate code. code='+item.code);

    ht[item.code] = item;

    return ht;
}, {});

export default ROOTS;
