import React from 'react';
import { Routes, Route } from 'react-router-dom';

import { pages as page, docPages as page_docs } from '@yanqirenshi/ihub.core';

export default function Router () {
    return (
        <Routes>
          {/* == iHub ================================================================ */}
          <Route path='/' element={<page.Bridge/>} />
          <Route path='/help'                      element={<page.Help/>} />
          <Route path='/markets'                   element={<page.Markets/>} />
          <Route path='/business'                  element={<page.Business/>} />
          <Route path='/api'                       element={<page.Api/>} />
          <Route path='/design'                    element={<page.Design/>} />
          <Route path='/screens'                   element={<page.Screens/>} />
          <Route path='/data'                      element={<page.Data/>} />
          <Route path='/classes'                   element={<page.Classes/>} />
          <Route path='/external-resources'        element={<page.ExternalResources/>} />
          <Route path='/system-environment'        element={<page.SystemEnvironment/>} />
          <Route path='/message'                   element={<page.Messages/>} />
          <Route path='/devops'                    element={<page.DevOps/>} />
          <Route path='/organizations'             element={<page.Organizations/>} />
          <Route path='/wbs'                       element={<page.Wbs/>} />
          <Route path='/wbs/:wbs_id'               element={<page.WbsNode/>} />

          {/* == Scrum ================================================================ */}
          {/* /scrum root. viewer の画面 */}
          <Route path='/scrum'       element={<page.Scrum/>} />
          {/* /scrum/users/:user-login/projects */}
          {/* /scrum/users/:user-login/projects/:project-num */}
          <Route path='/scrum/users/:login/projects'         element={<page.Scrum/>} />
          <Route path='/scrum/users/:login/projects/:number' element={<page.ScrumProject/>} />

          {/* ProjectV2 Item */}
          {/* /scrum/users/:user-login/projects/:project-num/items/:item-id */}
          <Route path='/scrum/users/:login/projects/:number/items/:id' element={<page.ScrumProjectItem/>} />

          {/* Repository */}
          {/* /scrum/users/:user-login/repositories */}
          {/* /scrum/users/:user-login/repositories/:repository-name */}
          <Route path='/scrum/users/:login/repositories/:repository' element={<page.Scrum/>} />

          {/* Issue */}
          {/* /scrum/users/:user-login/repositories/:repository-name/issues/:num */}
          <Route path='/scrum/users/:login/repositories/:repository/issues/:number' element={<page.Scrum/>} />

          {/* Pull requests */}
          {/* /scrum/users/:user-login/repositories/:repository-name/pull/:num */}
          <Route path='/scrum/users/:login/repositories/:repository/pull/:num' element={<page.Scrum/>} />

          {/* Actions */}
          {/* /scrum/users/:user-login/repositories/:repository-name/actions/:num */}
          <Route path='/scrum/users/:login/repositories/:repository/actions/:num' element={<page.Scrum/>} />

          {/* Discussions */}
          {/* /scrum/users/:user-login/repositories/:repository-name/discussions/:num */}
          <Route path='/scrum/users/:login/repositories/:repository/discussions/:num' element={<page.Scrum/>} />

          {/* == Docs ================================================================ */}
          {/* ux */}
          <Route path='/systemic-design'       element={<page.SystemicDesign/>} />
          <Route path='/systemic-design/:name' element={<page.SystemicDesignContents/>} />
          {/* == ui ================================================================ */}
          {/* { path: '/screens'                   element={page }, */}
          {/* { path: '/assemblies'                element={page }, */}
          {/* { path: '/parts'                     element={page }, */}
          <Route path='/batchs'                    element={<page.Batchs/>} />
          <Route path='/actions'                   element={<page.Actions/>} />
          {/* == Etc ================================================================ */}
          <Route path='/system-dynamics'           element={<page.SystemDynamics/>} />
          <Route path='/ddd'                       element={<page.DDD/>} />
          <Route path='/account'                   element={<page.Account/>} />
          <Route path='/auth'                      element={<page.Auth/>} />
          {/* == Docs ================================================================ */}
          <Route path='/bpmn'                      element={<page_docs.BPMN/>} />
          <Route path='/classes'                   element={<page_docs.Classes/>} />
          <Route path='/customer-journey-map'      element={<page_docs.CustomerJourneyMap/>} />
          <Route path='/er'                        element={<page_docs.ER/>} />
          <Route path='/procedures'                element={<page_docs.Procedures/>} />
          <Route path='/screen-transition-diagram' element={<page_docs.ScreenTransitionDiagram/>} />
          <Route path='/tm'                        element={<page_docs.TM/>} />
          <Route path='/uml'                       element={<page_docs.UML/>} />
          <Route path='/use-case'                  element={<page_docs.UseCase/>} />
          <Route path='/user-scenario'             element={<page_docs.UserScenario/>} />
          <Route path='/pad'                       element={<page_docs.PAD/>} />
        </Routes>
    );
}
