/**
 * Hierarchy Tree - Display component hierarchy as expandable tree
 * Part of Issue #28 - Enhanced Detail and Editing
 */

import { useState, useEffect } from 'react';

function HierarchyTree({ sceneManager, onSelectObject, selectedObjectIds = [] }) {
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [treeData, setTreeData] = useState([]);

  useEffect(() => {
    if (!sceneManager) return;

    // Build tree structure from scene objects
    const buildTree = () => {
      const objects = sceneManager.getAllObjects();
      const rootObjects = objects.filter(obj => !obj.parent);
      
      // Group by design if available
      const designs = sceneManager.getAllDesigns();
      
      if (designs && designs.length > 0) {
        return designs.map(design => ({
          id: design.id,
          name: `Design: ${design.metadata?.prompt?.substring(0, 30) || design.id}`,
          type: 'design',
          children: design.objects.map(objId => {
            const obj = sceneManager.getObject(objId);
            return obj ? buildTreeNode(obj, objects) : null;
          }).filter(Boolean),
          metadata: design.metadata,
        }));
      } else {
        // No designs, just show root objects
        return rootObjects.map(obj => buildTreeNode(obj, objects));
      }
    };

    const buildTreeNode = (obj, allObjects) => {
      const children = obj.children || [];
      const childObjects = children
        .map(childId => allObjects.find(o => o.id === childId))
        .filter(Boolean);

      return {
        id: obj.id,
        name: obj.name || obj.id,
        type: obj.type,
        componentType: obj.userData?.componentType,
        children: childObjects.map(child => buildTreeNode(child, allObjects)),
        visible: obj.visible !== false,
        locked: obj.locked || false,
        metadata: obj.userData,
      };
    };

    setTreeData(buildTree());
  }, [sceneManager]);

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleNodeClick = (nodeId, nodeType) => {
    if (nodeType === 'design') return; // Don't select design groups
    if (onSelectObject) {
      onSelectObject(nodeId);
    }
  };

  const renderNode = (node, level = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedObjectIds.includes(node.id);

    return (
      <div key={node.id} style={styles.nodeContainer}>
        <div
          style={{
            ...styles.node,
            paddingLeft: `${level * 20 + 10}px`,
            backgroundColor: isSelected ? '#2a4a6a' : 'transparent',
          }}
          onClick={() => handleNodeClick(node.id, node.type)}
        >
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(node.id);
              }}
              style={styles.expandButton}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          
          {!hasChildren && <span style={styles.indent}>  </span>}
          
          <span style={styles.icon}>
            {node.type === 'design' ? '📦' : getIconForType(node.componentType || node.type)}
          </span>
          
          <span style={styles.nodeName}>{node.name}</span>
          
          {node.componentType && (
            <span style={styles.badge}>{node.componentType}</span>
          )}
          
          <div style={styles.nodeActions}>
            {node.visible !== undefined && (
              <button
                style={styles.actionButton}
                title={node.visible ? 'Visible' : 'Hidden'}
              >
                {node.visible ? '👁' : '👁‍🗨'}
              </button>
            )}
            {node.locked && (
              <button style={styles.actionButton} title="Locked">
                🔒
              </button>
            )}
          </div>
        </div>
        
        {hasChildren && isExpanded && (
          <div style={styles.children}>
            {node.children.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Scene Hierarchy</h3>
        <div style={styles.stats}>
          {treeData.length} {treeData.length === 1 ? 'item' : 'items'}
        </div>
      </div>
      
      <div style={styles.toolbar}>
        <button
          style={styles.toolbarButton}
          onClick={() => setExpandedNodes(new Set())}
          title="Collapse All"
        >
          Collapse All
        </button>
        <button
          style={styles.toolbarButton}
          onClick={() => {
            const allIds = new Set();
            const collectIds = (nodes) => {
              nodes.forEach(node => {
                allIds.add(node.id);
                if (node.children) collectIds(node.children);
              });
            };
            collectIds(treeData);
            setExpandedNodes(allIds);
          }}
          title="Expand All"
        >
          Expand All
        </button>
      </div>
      
      <div style={styles.content}>
        {treeData.length === 0 ? (
          <div style={styles.emptyMessage}>
            <p>No objects in scene</p>
            <p style={styles.hint}>Generate a design to see hierarchy</p>
          </div>
        ) : (
          treeData.map(node => renderNode(node))
        )}
      </div>
    </div>
  );
}

function getIconForType(type) {
  const icons = {
    building_structure: '🏢',
    floor_slab: '⬜',
    curtain_wall_panel: '🪟',
    window: '🪟',
    window_frame: '🔲',
    balcony: '🏛',
    entrance: '🚪',
    column: '⚙',
    box: '📦',
    sphere: '⚽',
    cylinder: '🥫',
    cone: '🎪',
    default: '●',
  };
  return icons[type] || icons.default;
}

const styles = {
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
    color: '#e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '15px',
    borderBottom: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
  },
  stats: {
    fontSize: '12px',
    color: '#999',
  },
  toolbar: {
    padding: '8px 15px',
    borderBottom: '1px solid #333',
    display: 'flex',
    gap: '8px',
  },
  toolbarButton: {
    padding: '4px 12px',
    fontSize: '11px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#e0e0e0',
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '5px 0',
  },
  emptyMessage: {
    color: '#999',
    textAlign: 'center',
    marginTop: '50px',
  },
  hint: {
    color: '#666',
    fontSize: '12px',
    marginTop: '10px',
  },
  nodeContainer: {
    userSelect: 'none',
  },
  node: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'background-color 0.15s',
    '&:hover': {
      backgroundColor: '#252525',
    },
  },
  expandButton: {
    background: 'none',
    border: 'none',
    color: '#999',
    cursor: 'pointer',
    padding: '0 5px',
    fontSize: '10px',
    marginRight: '5px',
  },
  indent: {
    marginRight: '10px',
  },
  icon: {
    marginRight: '8px',
    fontSize: '14px',
  },
  nodeName: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  badge: {
    fontSize: '10px',
    backgroundColor: '#333',
    padding: '2px 6px',
    borderRadius: '3px',
    marginLeft: '8px',
    color: '#999',
  },
  nodeActions: {
    display: 'flex',
    gap: '4px',
    marginLeft: '8px',
  },
  actionButton: {
    background: 'none',
    border: 'none',
    padding: '2px 4px',
    fontSize: '12px',
    cursor: 'pointer',
    opacity: 0.6,
  },
  children: {
    // Children are rendered with increased padding via level
  },
};

export default HierarchyTree;
