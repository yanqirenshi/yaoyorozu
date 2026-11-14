import React from 'react';

import { ProjectItemForm } from '@yanqirenshi/ihub.core';

import Other from './Other.js';
import AccountMenuSettings from './AccountMenuSettings.js';

export default function Operators (props) {
    const root = props.root;

    if ('a'===root.code)
        return <Other root={root}/>;

    if ('b'===root.code)
        return <ProjectItemForm root={root}/>;

    if ('c'===root.code)
        return <AccountMenuSettings root={root}/>;

    return <Other root={root}/>;
}
